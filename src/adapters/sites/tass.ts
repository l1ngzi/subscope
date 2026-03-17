import * as cheerio from 'cheerio'
import { item, sortDesc, fetchWithCffi } from '../../lib.ts'
import type { Source, FeedItem } from '../../types.ts'

const BASE = 'https://tass.com'

// TASS RSS is dead (stuck at June 2025). Angular SPA with no API.
// cffi fetches server-rendered HTML which has article links.
export const fetchTASS = async (source: Source): Promise<FeedItem[]> => {
  const $ = cheerio.load(await fetchWithCffi(source.url))
  const items: FeedItem[] = []
  const seen = new Set<string>()

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href')
    if (!href || !/^\/\w+\/\d{5,}$/.test(href)) return  // /section/1234567

    const url = `${BASE}${href}`
    if (seen.has(url)) return
    seen.add(url)

    // Title: prefer .news-preview__title (avoids category label concatenation)
    let title = $(el).find('.news-preview__title').first().text().trim()
      || $(el).find('h1, h2, h3').first().text().trim()
      || $(el).text().trim()
    title = title.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim()
    if (!title || title.length < 10 || title.length > 300) return

    items.push(item(source, url, title))
  })

  return sortDesc(items)
}
