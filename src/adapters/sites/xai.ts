import * as cheerio from 'cheerio'
import { item, sortDesc } from '../../lib.ts'
import type { Source, FeedItem } from '../../types.ts'

const BASE = 'https://x.ai'

export const fetchXai = async (source: Source): Promise<FeedItem[]> => {
  const html = await fetch(source.url).then(r => r.text())
  const $ = cheerio.load(html)
  const items: FeedItem[] = []
  const seen = new Set<string>()

  $('a[href^="/news/"]').each((_, el) => {
    const href = $(el).attr('href')!
    const title = $(el).text().trim().replace(/\s+/g, ' ')
    if (!title || title.length < 5 || seen.has(href)) return
    seen.add(href)
    items.push(item(source, `${BASE}${href}`, title, { key: href }))
  })

  // Extract dates from page text and match to items by proximity
  const dateMatches = [...$.text().matchAll(/((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4})/g)]
  for (let i = 0; i < items.length && i < dateMatches.length; i++) {
    items[i]!.publishedAt = new Date(dateMatches[i]![1]!).toISOString()
  }

  return sortDesc(items)
}
