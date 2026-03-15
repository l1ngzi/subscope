import { createHash } from 'crypto'
import { join } from 'path'
import { homedir } from 'os'
import { readFileSync, existsSync } from 'fs'
import { parse } from 'yaml'
import type { Source, FeedItem, SourceAdapter } from '../types.ts'

const hash = (...parts: string[]) =>
  createHash('sha256').update(parts.join(':')).digest('hex').slice(0, 12)

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

    const authToken = loadAuthToken()
    if (!authToken) {
      throw new Error('X auth required. Run: subscope auth x <token>')
    }

    return fetchWithPlaywright(username, authToken, source)
  },
}

// ── Playwright via Node subprocess ──

const fetchWithPlaywright = async (username: string, authToken: string, source: Source): Promise<FeedItem[]> => {
  const proc = Bun.spawn(['node', SCRAPER_SCRIPT, username, authToken], {
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 45_000,
  })

  const stdout = await new Response(proc.stdout).text()
  const exitCode = await proc.exited

  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text()
    throw new Error(`X scraper failed: ${stderr.slice(0, 100)}`)
  }

  const tweets: RawTweet[] = JSON.parse(stdout)
  if (tweets.length === 0) {
    throw new Error('X scraper returned 0 tweets — auth token may be expired')
  }

  return mergeThreads(tweets, username, source)
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

type RawTweet = { id: string; text: string; date: string; replyToId?: string | null; convId?: string }

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
    if (tweet.convId && byId.has(tweet.convId)) rootId = tweet.convId

    const group = threadMap.get(rootId) ?? []
    if (!assigned.has(tweet.id)) {
      group.push(tweet)
      assigned.add(tweet.id)
    }
    threadMap.set(rootId, group)
  }

  for (const tweet of byId.values()) {
    if (assigned.has(tweet.id)) continue
    if (tweet.replyToId && assigned.has(tweet.replyToId)) {
      for (const [, group] of threadMap) {
        if (group.some(t => t.id === tweet.replyToId)) {
          group.push(tweet)
          assigned.add(tweet.id)
          break
        }
      }
    }
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

// ── Helpers ──

const extractUsername = (url: string): string | null => {
  const { pathname } = new URL(url)
  const match = pathname.match(/^\/?@?([\w]+)/)
  return match?.[1] ?? null
}

const cleanTweetText = (text: string): string =>
  text.replace(/https:\/\/t\.co\/\w+/g, '').replace(/\s+/g, ' ').trim()
