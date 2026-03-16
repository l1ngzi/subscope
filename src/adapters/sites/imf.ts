import * as cheerio from 'cheerio'
import { item, sortDesc, fetchWithCffi } from '../../lib.ts'
import type { Source, FeedItem } from '../../types.ts'

const BASE = 'https://www.imf.org'

export const fetchIMF = async (source: Source): Promise<FeedItem[]> => {
  const $ = cheerio.load(fetchWithCffi(source.url))
  const items: FeedItem[] = []
  const seen = new Set<string>()

  $('div.link-list--news li a[href*="/news/articles/"]').each((_, el) => {
    const $a = $(el)
    const href = $a.attr('href')
    if (!href) return

    const dateText = $a.find('span').first().text().trim()
    const title = $a.text().replace(dateText, '').trim()
    if (!title) return

    const url = href.startsWith('http') ? href : `${BASE}${href}`
    if (seen.has(url)) return
    seen.add(url)

    items.push(item(source, url, title, {
      publishedAt: dateText ? new Date(dateText).toISOString() : undefined,
    }))
  })

  return sortDesc(items)
}
