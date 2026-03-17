import * as cheerio from 'cheerio'
import { item, sortDesc, fetchWithCffi } from '../../lib.ts'
import type { Source, FeedItem } from '../../types.ts'

const BASE = 'https://home.treasury.gov'

export const fetchTreasury = async (source: Source): Promise<FeedItem[]> => {
  const $ = cheerio.load(await fetchWithCffi(source.url))
  const items: FeedItem[] = []
  const seen = new Set<string>()

  $('div.mm-news-row').each((_, el) => {
    const $a = $(el).find('.news-title a, a')
    const title = $a.text().trim()
    const href = $a.attr('href')
    if (!title || !href) return

    const url = href.startsWith('http') ? href : `${BASE}${href}`
    if (seen.has(url)) return
    seen.add(url)

    const datetime = $(el).find('time').attr('datetime')
    items.push(item(source, url, title, {
      publishedAt: datetime ? new Date(datetime).toISOString() : undefined,
    }))
  })

  return sortDesc(items)
}
