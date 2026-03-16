import { createHash } from 'crypto'
import { join } from 'path'
import { homedir } from 'os'
import type { Source, FeedItem } from './types.ts'

export const DIR = join(homedir(), '.subscope')

export const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

// Skip cert verification only for government/institutional sites with proxy/cert issues
const INSECURE_HOSTS = [
  // US/EU
  'bls.gov', 'bea.gov', 'sec.gov', 'treasury.gov', 'imf.org', 'ftc.gov',
  'federalreserve.gov', 'ecb.europa.eu',
  // China (CDN/proxy cert issues common)
  'pbc.gov.cn', 'stats.gov.cn', 'csrc.gov.cn', 'mof.gov.cn',
  'safe.gov.cn', 'nfra.gov.cn', 'news.cctv.com', 'news.cn', 'people.com.cn',
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

/** Universal page fetch — cffi (Safari TLS) first, Bun fetch fallback.
 *  Use this for all HTML fetching. Returns HTML string. */
export const fetchPage = (url: string): string => {
  try { return fetchWithCffi(url) } catch {}
  // Fallback: Bun native fetch (sync via spawnSync to keep API consistent)
  const r = Bun.spawnSync(['bun', '-e', `
    const res = await fetch(${JSON.stringify(url)}, {
      headers: { 'User-Agent': ${JSON.stringify(UA)} },
      tls: { rejectUnauthorized: false },
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    process.stdout.write(await res.text());
  `], { stdout: 'pipe', stderr: 'pipe', timeout: 20_000 })
  if (r.exitCode !== 0) throw new Error(`fetchPage failed: ${new TextDecoder().decode(r.stderr).trim().slice(0, 100)}`)
  return new TextDecoder().decode(r.stdout)
}

/** Fetch via curl_cffi (Python) — impersonates Safari/Chrome TLS fingerprint.
 *  Bypasses Azure WAF and other advanced bot detection that checks JA3/JA4. */
export const fetchWithCffi = (url: string, impersonate = 'safari17_0'): string => {
  const script = join(import.meta.dir, 'cffi_fetch.py')
  const r = Bun.spawnSync(['python', script, url, impersonate], {
    stdout: 'pipe', stderr: 'pipe', timeout: 20_000,
  })
  if (r.exitCode !== 0) throw new Error(`cffi_fetch failed: ${new TextDecoder().decode(r.stderr).trim()}`)
  return new TextDecoder().decode(r.stdout)
}

/** Fetch via curl — bypasses Cloudflare's TLS fingerprint blocking.
 *  Bun's BoringSSL gets 403; curl's OpenSSL + Client Hints passes. */
export const fetchWithCurl = (url: string): string => {
  const r = Bun.spawnSync(['curl', '-sL', '--max-time', '15', url,
    '-A', UA,
    '-H', 'Sec-CH-UA: "Google Chrome";v="131", "Chromium";v="131"',
    '-H', 'Sec-CH-UA-Mobile: ?0',
    '-H', 'Sec-CH-UA-Platform: "Windows"',
    '-H', 'Sec-Fetch-Dest: document',
    '-H', 'Sec-Fetch-Mode: navigate',
    '-H', 'Sec-Fetch-Site: none',
  ], { stdout: 'pipe', stderr: 'pipe', timeout: 20_000 })
  if (r.exitCode !== 0) throw new Error(`curl failed: ${new TextDecoder().decode(r.stderr).trim()}`)
  const html = new TextDecoder().decode(r.stdout)
  if (html.length < 1000) throw new Error(`blocked (${html.length}b)`)
  return html
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
