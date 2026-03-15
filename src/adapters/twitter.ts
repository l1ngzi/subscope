import { createHash } from 'crypto'
import { join } from 'path'
import { homedir } from 'os'
import { readFileSync, existsSync } from 'fs'
import { parse } from 'yaml'
import type { Source, FeedItem, SourceAdapter } from '../types.ts'

const hash = (...parts: string[]) =>
  createHash('sha256').update(parts.join(':')).digest('hex').slice(0, 12)

const SYNDICATION_URL = 'https://syndication.twitter.com/srv/timeline-profile/screen-name/'
const STALE_DAYS = 30 // if newest tweet is older than this, data is stale
const AUTH_FILE = join(homedir(), '.subscope', 'auth.yml')
const SCRAPER_SCRIPT = join(import.meta.dir, 'x-scraper.cjs')

export const twitter: SourceAdapter = {
  type: 'twitter',
  test: (url: string) => {
    const { hostname } = new URL(url)
    return hostname.includes('twitter.com') || hostname.includes('x.com')
  },

  async fetch(source: Source): Promise<FeedItem[]> {
    const username = extractUsername(source.url)
    if (!username) return []

    // Try syndication first (fast, no auth needed)
    const items = await fetchSyndication(username, source)

    // Check if data is stale
    const newest = items[0]?.publishedAt
    const isStale = !newest || (Date.now() - new Date(newest).getTime()) > STALE_DAYS * 86_400_000

    if (!isStale) return items

    // Syndication is stale — try Playwright with auth cookie
    const authToken = loadAuthToken()
    if (!authToken) return items // no auth, return stale data

    const freshItems = await fetchWithPlaywright(username, authToken, source)
    return freshItems.length > 0 ? freshItems : items
  },
}

// ── Syndication (free, no auth) ──

const fetchSyndication = async (username: string, source: Source): Promise<FeedItem[]> => {
  try {
    const res = await fetch(`${SYNDICATION_URL}${username}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    })
    if (!res.ok) return []

    const html = await res.text()
    const match = html.match(/<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s)
    if (!match) return []

    const data = JSON.parse(match[1]!)
    const entries: any[] = data?.props?.pageProps?.timeline?.entries ?? []

    // Collect all tweets, grouped by conversation
    const tweets: { id: string; text: string; date: string; convId: string; replyTo: string | null }[] = []
    for (const entry of entries) {
      const t = entry?.content?.tweet
      if (!t?.text || !t?.id_str) continue
      if (t.retweeted_status_result) continue
      tweets.push({
        id: t.id_str,
        text: t.text,
        date: t.created_at,
        convId: t.conversation_id_str ?? t.id_str,
        replyTo: t.in_reply_to_status_id_str ?? null,
      })
    }

    // Group into threads by conversation_id
    const threads = new Map<string, typeof tweets>()
    for (const t of tweets) {
      const group = threads.get(t.convId) ?? []
      group.push(t)
      threads.set(t.convId, group)
    }

    const items: FeedItem[] = []
    for (const [convId, thread] of threads) {
      // Sort thread: root first, then replies in order
      thread.sort((a, b) => a.id.localeCompare(b.id))

      const root = thread[0]!
      const title = cleanTweetText(root.text)
      const replies = thread.slice(1).map(t => cleanTweetText(t.text)).filter(Boolean)
      const summary = replies.length > 0 ? replies.join(' · ') : undefined

      items.push({
        id: hash(source.id, convId),
        sourceId: source.id,
        sourceType: 'twitter',
        sourceName: source.name,
        title,
        url: `https://x.com/${username}/status/${root.id}`,
        summary: summary?.slice(0, 300),
        publishedAt: new Date(root.date).toISOString(),
      })
    }

    return items.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
  } catch {
    return []
  }
}

// ── Playwright fallback (needs auth_token cookie, runs via Node) ──

const fetchWithPlaywright = async (username: string, authToken: string, source: Source): Promise<FeedItem[]> => {
  try {
    const proc = Bun.spawn(['node', SCRAPER_SCRIPT, username, authToken], {
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 30_000,
    })

    const stdout = await new Response(proc.stdout).text()
    const exitCode = await proc.exited

    if (exitCode !== 0) return []

    const tweets: { id: string; text: string; date: string }[] = JSON.parse(stdout)

    return tweets.map(t => ({
      id: hash(source.id, t.id),
      sourceId: source.id,
      sourceType: 'twitter' as const,
      sourceName: source.name,
      title: cleanTweetText(t.text),
      url: `https://x.com/${username}/status/${t.id}`,
      publishedAt: t.date ? new Date(t.date).toISOString() : new Date().toISOString(),
    })).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
  } catch {
    return []
  }
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

// ── Helpers ──

const extractUsername = (url: string): string | null => {
  const { pathname } = new URL(url)
  const match = pathname.match(/^\/?@?([\w]+)/)
  return match?.[1] ?? null
}

const cleanTweetText = (text: string): string =>
  text.replace(/https:\/\/t\.co\/\w+/g, '').replace(/\s+/g, ' ').trim()
