import { createHash } from 'crypto'
import { join } from 'path'
import { homedir } from 'os'
import { readFileSync, existsSync } from 'fs'
import { parse } from 'yaml'
import type { Source, FeedItem, SourceAdapter } from '../types.ts'

const hash = (...parts: string[]) =>
  createHash('sha256').update(parts.join(':')).digest('hex').slice(0, 12)

const AUTH_FILE = join(homedir(), '.subscope', 'auth.yml')

// X web app's public bearer token (baked into their JS, never changes)
const BEARER = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA'

const FEATURES = JSON.stringify({
  rweb_tipjar_consumption_enabled: true,
  responsive_web_graphql_exclude_directive_enabled: true,
  verified_phone_label_enabled: false,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  communities_web_enable_tweet_community_results_fetch: true,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  articles_preview_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  tweet_awards_web_tipping_enabled: false,
  creator_subscriptions_quote_tweet_preview_enabled: false,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  rweb_video_timestamps_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: true,
  responsive_web_enhance_cards_enabled: false,
})

// Cache auth session across sources
let sessionCache: { ct0: string; authToken: string } | null = null

export const twitter: SourceAdapter = {
  type: 'twitter',
  test: (url: string) => {
    const { hostname } = new URL(url)
    return hostname.includes('twitter.com') || hostname.includes('x.com')
  },

  async fetch(source: Source): Promise<FeedItem[]> {
    const username = extractUsername(source.url)
    if (!username) return []

    const session = await getSession()
    const userId = await resolveUserId(session, username)
    if (!userId) throw new Error(`X: user "${username}" not found`)

    const tweets = await fetchUserTweets(session, userId)
    return mergeThreads(tweets, username, source)
  },
}

// ── Session management ──

const getSession = async () => {
  if (sessionCache) return sessionCache

  const authToken = loadAuthToken()
  if (!authToken) throw new Error('X auth required. Run: subscope auth x <token>')

  const res = await fetch('https://x.com', {
    headers: { Cookie: `auth_token=${authToken}` },
    redirect: 'manual',
  })

  const ct0 = res.headers.getSetCookie?.()
    .find(c => c.startsWith('ct0='))?.split('=')[1]?.split(';')[0]

  if (!ct0) throw new Error('X: failed to get CSRF token — auth_token may be expired')

  sessionCache = { ct0, authToken }
  return sessionCache
}

const apiHeaders = (session: { ct0: string; authToken: string }) => ({
  Authorization: `Bearer ${BEARER}`,
  'X-Csrf-Token': session.ct0,
  Cookie: `auth_token=${session.authToken}; ct0=${session.ct0}`,
})

// ── GraphQL calls ──

const resolveUserId = async (session: { ct0: string; authToken: string }, username: string): Promise<string | null> => {
  const variables = JSON.stringify({ screen_name: username })
  const userFeatures = JSON.stringify({
    hidden_profile_subscriptions_enabled: true,
    responsive_web_graphql_exclude_directive_enabled: true,
    verified_phone_label_enabled: false,
    responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
    responsive_web_graphql_timeline_navigation_enabled: true,
  })

  const url = `https://x.com/i/api/graphql/xc8f1g7BYqr6VTzTbvNlGw/UserByScreenName?variables=${encodeURIComponent(variables)}&features=${encodeURIComponent(userFeatures)}`
  const res = await fetch(url, { headers: apiHeaders(session) })
  if (!res.ok) return null

  const data = await res.json() as any
  return data?.data?.user?.result?.rest_id ?? null
}

const fetchUserTweets = async (session: { ct0: string; authToken: string }, userId: string): Promise<RawTweet[]> => {
  const variables = JSON.stringify({
    userId,
    count: 40,
    includePromotedContent: false,
    withQuickPromoteEligibilityTweetFields: false,
    withVoice: false,
    withV2Timeline: true,
  })

  const url = `https://x.com/i/api/graphql/E3opETHurmVJflFsUBVuUQ/UserTweets?variables=${encodeURIComponent(variables)}&features=${encodeURIComponent(FEATURES)}`
  const res = await fetch(url, { headers: apiHeaders(session) })
  if (!res.ok) throw new Error(`X API: ${res.status}`)

  const data = await res.json()

  // Recursively extract all tweet objects from the response
  const tweets: RawTweet[] = []
  const seen = new Set<string>()

  const walk = (obj: any) => {
    if (!obj || typeof obj !== 'object') return
    const legacy = obj.legacy
    if (legacy?.full_text && legacy?.id_str && !seen.has(legacy.id_str)) {
      seen.add(legacy.id_str)
      tweets.push({
        id: legacy.id_str,
        text: legacy.full_text,
        date: legacy.created_at,
        convId: legacy.conversation_id_str ?? legacy.id_str,
        replyToId: legacy.in_reply_to_status_id_str ?? null,
      })
    }
    for (const v of Object.values(obj)) {
      if (typeof v === 'object') walk(v)
    }
  }

  walk(data)
  return tweets
}

// ── Auth ──

const loadAuthToken = (): string | null => {
  try {
    if (!existsSync(AUTH_FILE)) return null
    const raw = parse(readFileSync(AUTH_FILE, 'utf-8')) as any
    return raw?.x?.auth_token ?? null
  } catch {
    return null
  }
}

// ── Thread merging ──

type RawTweet = { id: string; text: string; date: string; replyToId: string | null; convId: string }

const mergeThreads = (tweets: RawTweet[], username: string, source: Source): FeedItem[] => {
  const byId = new Map<string, RawTweet>()
  for (const t of tweets) byId.set(t.id, t)

  const threadMap = new Map<string, RawTweet[]>()
  const assigned = new Set<string>()

  for (const tweet of byId.values()) {
    if (assigned.has(tweet.id)) continue

    let rootId = tweet.id
    let current = tweet
    while (current.replyToId && byId.has(current.replyToId)) {
      rootId = current.replyToId
      current = byId.get(current.replyToId)!
    }
    if (byId.has(tweet.convId)) rootId = tweet.convId

    const group = threadMap.get(rootId) ?? []
    group.push(tweet)
    assigned.add(tweet.id)
    threadMap.set(rootId, group)
  }

  const items: FeedItem[] = []
  for (const [rootId, thread] of threadMap) {
    thread.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

    const root = thread[0]!
    const title = cleanTweetText(root.text)
    const replies = thread.slice(1).map(t => cleanTweetText(t.text)).filter(Boolean)
    const summary = replies.length > 0 ? replies.join(' \u00b7 ') : undefined

    items.push({
      id: hash(source.id, rootId),
      sourceId: source.id,
      sourceType: 'twitter',
      sourceName: source.name,
      title,
      url: `https://x.com/${username}/status/${root.id}`,
      summary: summary?.slice(0, 300),
      publishedAt: root.date ? new Date(root.date).toISOString() : new Date().toISOString(),
    })
  }

  return items.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
}

const extractUsername = (url: string): string | null => {
  const { pathname } = new URL(url)
  return pathname.match(/^\/?@?([\w]+)/)?.[1] ?? null
}

const cleanTweetText = (text: string): string =>
  text.replace(/https:\/\/t\.co\/\w+/g, '').replace(/\s+/g, ' ').trim()
