import * as cheerio from 'cheerio'
import { item, sortDesc, UA, TLS } from '../../lib.ts'
import type { Source, FeedItem } from '../../types.ts'

export const fetchFTC = async (source: Source): Promise<FeedItem[]> => {
  const res = await fetch(source.url, { headers: { 'User-Agent': UA }, ...TLS(source.url) } as any)
  if (!res.ok) throw new Error(`FTC: ${res.status}`)
  const $ = cheerio.load(await res.text(), { xml: true })

  return sortDesc($('item').map((_, el) => {
    const title = $(el).find('title').first().text().trim()
    const link = $(el).find('link').attr('href') ?? $(el).find('link').first().text().trim()
    if (!title || !link) return null
    const date = $(el).find('pubDate').first().text().trim()
    return item(source, link, title, {
      publishedAt: date ? new Date(date).toISOString() : undefined,
    })
  }).get().filter(Boolean) as FeedItem[])
}
