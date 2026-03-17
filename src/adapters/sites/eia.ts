import * as cheerio from 'cheerio'
import { item, sortDesc, fetchWithCffi } from '../../lib.ts'
import type { Source, FeedItem } from '../../types.ts'

const BASE = 'https://www.eia.gov/todayinenergy/'

// EIA blocks Bun's TLS but cffi passes. RSS is 15KB vs 90KB HTML.
export const fetchEIA = async (source: Source): Promise<FeedItem[]> => {
  const $ = cheerio.load(await fetchWithCffi(source.url), { xml: true })
  const items: FeedItem[] = []

  $('item').each((_, el) => {
    const title = $(el).find('title').text().trim()
    const link = $(el).find('link').text().trim()
    const pubDate = $(el).find('pubDate').text().trim()
    if (!title || !link) return

    items.push(item(source, link, title, {
      publishedAt: pubDate ? new Date(pubDate).toISOString() : undefined,
    }))
  })

  return sortDesc(items)
}
