import { join } from 'path'
import { readFileSync, existsSync } from 'fs'
import { parse } from 'yaml'
import { hash, item, sortDesc, DIR } from '../lib.ts'
import type { Source, FeedItem, SourceAdapter } from '../types.ts'

const AUTH_FILE = join(DIR, 'auth.yml')

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

// Session cache — CSRF token reused across all X sources in one fetch cycle
// Promise-based mutex: concurrent callers await the same in-flight request
let sessionPromise: Promise<{ ct0: string; authToken: string }> | null = null

export const twitter: SourceAdapter = {
  type: 'twitter',
  test: (url: string) => {
    const { hostname } = new URL(url)
    return hostname.includes('twitter.com') || hostname.includes('x.com')
  },

  async fetch(source: Source): Promise<FeedItem[]> {
    // Extract handle: "x.com/AnthropicAI" or "x.com/@AnthropicAI" → "AnthropicAI"
    const username = source.url.match(/(?:x\.com|twitter\.com)\/?@?([\w]+)/)?.[1]
    if (!username) return []

    const session = await getSession()
    const userId = await resolveUserId(session, username)
    if (!userId) throw new Error(`X: user "${username}" not found`)

    return mergeThreads(await fetchUserTweets(session, userId), username, source)
  },
}

// ── Session ──

const getSession = () => {
  if (sessionPromise) return sessionPromise

  sessionPromise = (async () => {
    const authToken = (() => {
      try {
        if (!existsSync(AUTH_FILE)) return null
        return (parse(readFileSync(AUTH_FILE, 'utf-8')) as any)?.x?.auth_token ?? null
      } catch { return null }
    })()
    if (!authToken) throw new Error('X auth required. Run: subscope auth x <token>')

    const res = await fetch('https://x.com', {
      headers: { Cookie: `auth_token=${authToken}` },
      redirect: 'manual',
    })
    const cookies = res.headers.getSetCookie?.() ?? []
    const ct0 = cookies.find(c => c.startsWith('ct0='))?.split('=')[1]?.split(';')[0]
    if (!ct0) throw new Error('X: failed to get CSRF token — auth_token may be expired')

    return { ct0, authToken }
  })()

  return sessionPromise
}

const apiHeaders = (s: { ct0: string; authToken: string }) => ({
  Authorization: `Bearer ${BEARER}`,
  'X-Csrf-Token': s.ct0,
  Cookie: `auth_token=${s.authToken}; ct0=${s.ct0}`,
})

// ── GraphQL ──

const resolveUserId = async (session: { ct0: string; authToken: string }, username: string): Promise<string | null> => {
  const variables = JSON.stringify({ screen_name: username })
  const features = JSON.stringify({
    hidden_profile_subscriptions_enabled: true,
    responsive_web_graphql_exclude_directive_enabled: true,
    verified_phone_label_enabled: false,
    responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
    responsive_web_graphql_timeline_navigation_enabled: true,
  })
  const url = `https://x.com/i/api/graphql/xc8f1g7BYqr6VTzTbvNlGw/UserByScreenName?variables=${encodeURIComponent(variables)}&features=${encodeURIComponent(features)}`
  const res = await fetch(url, { headers: apiHeaders(session) })
  if (!res.ok) return null
  return ((await res.json()) as any)?.data?.user?.result?.rest_id ?? null
}

const fetchUserTweets = async (session: { ct0: string; authToken: string }, userId: string): Promise<RawTweet[]> => {
  const variables = JSON.stringify({
    userId, count: 40, // X API max per page
    includePromotedContent: false,
    withQuickPromoteEligibilityTweetFields: false,
    withVoice: false, withV2Timeline: true,
  })
  const url = `https://x.com/i/api/graphql/E3opETHurmVJflFsUBVuUQ/UserTweets?variables=${encodeURIComponent(variables)}&features=${encodeURIComponent(FEATURES)}`
  const res = await fetch(url, { headers: apiHeaders(session) })
  if (!res.ok) throw new Error(`X API: ${res.status}`)

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

  walk(await res.json())
  return tweets
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

    // Walk reply chain to find root
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
    const replies = thread.slice(1).map(t => cleanTweet(t.text)).filter(Boolean)

    items.push(item(source, `https://x.com/${username}/status/${root.id}`, cleanTweet(root.text), {
      key: rootId,
      summary: replies.length > 0 ? replies.join(' \u00b7 ').slice(0, 300) : undefined,
      publishedAt: root.date ? new Date(root.date).toISOString() : undefined,
    }))
  }

  return sortDesc(items)
}

const cleanTweet = (text: string): string =>
  text.replace(/https:\/\/t\.co\/\w+/g, '').replace(/\s+/g, ' ').trim()
