import * as cheerio from 'cheerio'
import { createHash } from 'crypto'
import type { Source, FeedItem } from '../../types.ts'

const hash = (...parts: string[]) =>
  createHash('sha256').update(parts.join(':')).digest('hex').slice(0, 12)

const BASE = 'https://x.ai'

export const fetchXai = async (source: Source): Promise<FeedItem[]> => {
  const html = await fetch(source.url).then(r => r.text())
  const $ = cheerio.load(html)
  const items: FeedItem[] = []
  const seen = new Set<string>()

  // News links have /news/ prefix
  $('a[href^="/news/"]').each((_, el) => {
    const href = $(el).attr('href')!
    const title = $(el).text().trim().replace(/\s+/g, ' ')

    if (!title || title.length < 5 || seen.has(href)) return
    seen.add(href)

    const url = `${BASE}${href}`
    items.push({
      id: hash(source.id, href),
      sourceId: source.id,
      sourceType: 'website',
      sourceName: source.name,
      title,
      url,
      publishedAt: '', // will be filled below
    })
  })

  // Extract dates from page text and match to items by proximity
  const text = $.text()
  const dateMatches = [...text.matchAll(/((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4})/g)]

  for (let i = 0; i < items.length && i < dateMatches.length; i++) {
    items[i]!.publishedAt = new Date(dateMatches[i]![1]!).toISOString()
  }

  // Fill any missing dates
  for (const item of items) {
    if (!item.publishedAt) item.publishedAt = new Date().toISOString()
  }

  return items.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
}
