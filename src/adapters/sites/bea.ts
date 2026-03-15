import * as cheerio from 'cheerio'
import { createHash } from 'crypto'
import type { Source, FeedItem } from '../../types.ts'

const hash = (...parts: string[]) =>
  createHash('sha256').update(parts.join(':')).digest('hex').slice(0, 12)

const BASE = 'https://www.bea.gov'

// BEA current-releases page: <tr class="release-row"> with <a href="/news/..."> and <time datetime="ISO">
export const fetchBEA = async (source: Source): Promise<FeedItem[]> => {
  const res = await fetch(source.url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    tls: { rejectUnauthorized: false },
  } as any)
  const html = await res.text()
  const $ = cheerio.load(html)
  const items: FeedItem[] = []

  $('tr.release-row').each((_, el) => {
    const $a = $(el).find('a[href^="/news/"]')
    const title = $a.text().trim()
    const href = $a.attr('href')
    const datetime = $(el).find('time').attr('datetime')
    if (!title || !href) return

    const url = `${BASE}${href}`
    const publishedAt = datetime
      ? new Date(datetime).toISOString()
      : new Date().toISOString()

    items.push({
      id: hash(source.id, url),
      sourceId: source.id,
      sourceType: 'website',
      sourceName: source.name,
      title,
      url,
      publishedAt,
    })
  })

  return items.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
}
