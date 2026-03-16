import * as cheerio from 'cheerio'
import { item, sortDesc, UA, TLS } from '../../lib.ts'
import type { Source, FeedItem } from '../../types.ts'

const BASE = 'https://www.pbc.gov.cn'

export const fetchPBOC = async (source: Source): Promise<FeedItem[]> => {
  const res = await fetch(source.url, { headers: { 'User-Agent': UA }, ...TLS } as any)
  const $ = cheerio.load(await res.text())
  const items: FeedItem[] = []

  $('font.newslist_style').each((_, el) => {
    const $a = $(el).find('a')
    const title = $a.attr('title') || $a.text().trim()
    const href = $a.attr('href')
    if (!title || !href) return

    const url = href.startsWith('http') ? href : `${BASE}${href}`
    const dateText = $(el).closest('td').find('span.hui12').text().trim()

    items.push(item(source, url, title, {
      publishedAt: dateText ? new Date(dateText + 'T00:00:00+08:00').toISOString() : undefined,
    }))
  })

  return sortDesc(items)
}
