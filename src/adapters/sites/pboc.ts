import * as cheerio from 'cheerio'
import { createHash } from 'crypto'
import type { Source, FeedItem } from '../../types.ts'

const hash = (...parts: string[]) =>
  createHash('sha256').update(parts.join(':')).digest('hex').slice(0, 12)

const BASE = 'https://www.pbc.gov.cn'

export const fetchPBOC = async (source: Source): Promise<FeedItem[]> => {
  const res = await fetch(source.url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    tls: { rejectUnauthorized: false },
  } as any)
  const html = await res.text()
  const $ = cheerio.load(html)
  const items: FeedItem[] = []

  $('font.newslist_style').each((_, el) => {
    const $a = $(el).find('a')
    const title = $a.attr('title') || $a.text().trim()
    const href = $a.attr('href')
    if (!title || !href) return

    const url = href.startsWith('http') ? href : `${BASE}${href}`
    const dateText = $(el).closest('td').find('span.hui12').text().trim()
    const publishedAt = dateText
      ? new Date(dateText + 'T00:00:00+08:00').toISOString()
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
