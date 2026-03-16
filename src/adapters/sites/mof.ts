import * as cheerio from 'cheerio'
import { item, sortDesc, UA, TLS } from '../../lib.ts'
import type { Source, FeedItem } from '../../types.ts'

const BASE = 'https://www.mof.gov.cn'

export const fetchMOF = async (source: Source): Promise<FeedItem[]> => {
  const res = await fetch(source.url, { headers: { 'User-Agent': UA }, ...TLS(source.url) } as any)
  const $ = cheerio.load(await res.text())
  const items: FeedItem[] = []

  $('ul.xwfb_listbox li').each((_, el) => {
    const $a = $(el).find('a')
    const title = ($a.attr('title') || $a.text()).trim()
    const href = $a.attr('href')
    if (!title || !href) return

    const url = href.startsWith('http') ? href : new URL(href, source.url).href
    const dateText = $(el).find('span').text().trim()

    items.push(item(source, url, title, {
      publishedAt: dateText ? new Date(dateText + 'T00:00:00+08:00').toISOString() : undefined,
    }))
  })

  return sortDesc(items)
}
