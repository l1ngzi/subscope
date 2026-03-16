import { createHash } from 'crypto'
import { join } from 'path'
import { homedir } from 'os'
import type { Source, FeedItem } from './types.ts'

export const DIR = join(homedir(), '.subscope')

export const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

export const TLS = { tls: { rejectUnauthorized: false } }

export const hash = (...parts: string[]) =>
  createHash('sha256').update(parts.join(':')).digest('hex').slice(0, 12)

export const sourceId = (url: string) =>
  createHash('sha256').update(url).digest('hex').slice(0, 8)

export const sortDesc = <T extends { publishedAt: string }>(items: T[]): T[] =>
  items.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))

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
