import { createHash } from 'crypto'
import { join } from 'path'
import { homedir } from 'os'
import type { Source, FeedItem } from './types.ts'

export const DIR = join(homedir(), '.subscope')

export const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

// Skip cert verification only for government/institutional sites with proxy/cert issues
const INSECURE_HOSTS = [
  'bls.gov', 'bea.gov', 'sec.gov', 'treasury.gov', 'imf.org',
  'pbc.gov.cn', 'stats.gov.cn', 'federalreserve.gov', 'ecb.europa.eu',
]

export const TLS = (url?: string): { tls?: { rejectUnauthorized: boolean } } => {
  if (!url) return {}
  try {
    const host = new URL(url).hostname
    if (INSECURE_HOSTS.some(h => host.endsWith(h))) return { tls: { rejectUnauthorized: false } }
  } catch {}
  return {}
}

export const hash = (...parts: string[]) =>
  createHash('sha256').update(parts.join(':')).digest('hex').slice(0, 12)

export const sourceId = (url: string) =>
  createHash('sha256').update(url).digest('hex').slice(0, 8)

export const sortDesc = <T extends { publishedAt: string }>(items: T[]): T[] =>
  items.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))

/** Check if a source group matches a target group or is nested under it */
export const groupMatches = (sourceGroup: string, target: string): boolean =>
  sourceGroup === target || sourceGroup.startsWith(target + '/')

/** Find first matching element from a comma-separated CSS selector list */
export const findFirst = ($: any, selectors: string): { text: string; el: any } | null => {
  for (const sel of selectors.split(',')) {
    const $el = $(sel.trim())
    if (!$el.length) continue
    const text = $el.first().text()?.trim() ?? ''
    return { text, el: $el.first() }
  }
  return null
}

/** Convert date-only (from URL) to a reasonable timestamp.
 *  Uses noon local time, capped at current time to avoid future timestamps. */
export const dateOnlyToISO = (y: string, m: string, d: string, tz = '+08:00'): string => {
  const noon = new Date(`${y}-${m}-${d}T12:00:00${tz}`)
  const now = new Date()
  return (noon > now ? now : noon).toISOString()
}

/** Retry an async function up to `n` times with delay between attempts */
export const retry = async <T>(fn: () => Promise<T>, n: number, delay = 1000): Promise<T> => {
  for (let i = 0; i < n; i++) {
    try { return await fn() } catch (e) {
      if (i === n - 1) throw e
      await new Promise(r => setTimeout(r, delay * (i + 1)))
    }
  }
  throw new Error('unreachable')
}

export const item = (
  source: Source, url: string, title: string,
  opts?: { summary?: string; publishedAt?: string; key?: string },
): FeedItem => ({
  id: hash(source.id, opts?.key ?? url),
  sourceId: source.id,
  sourceType: source.type,
  sourceName: source.name,
  title, url,
  summary: opts?.summary,
  publishedAt: opts?.publishedAt ?? new Date().toISOString(),
})
