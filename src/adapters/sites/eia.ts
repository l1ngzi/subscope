import * as cheerio from 'cheerio'
import { item, sortDesc, UA, TLS } from '../../lib.ts'
import type { Source, FeedItem } from '../../types.ts'

const BASE = 'https://www.eia.gov/todayinenergy/'

export const fetchEIA = async (source: Source): Promise<FeedItem[]> => {
  const res = await fetch(source.url, { headers: { 'User-Agent': UA }, ...TLS(source.url) } as any)
  if (!res.ok) throw new Error(`EIA: ${res.status}`)
  const $ = cheerio.load(await res.text())
  const items: FeedItem[] = []

  $('.tie-article').each((_, el) => {
    const $a = $(el).find('h1 a, h2 a')
    const title = $a.text().trim()
    const href = $a.attr('href')
    if (!title || !href) return

    const url = href.startsWith('http') ? href : `${BASE}${href}`
    const dateText = $(el).find('.date').text().trim()

    items.push(item(source, url, title, {
      publishedAt: dateText ? new Date(dateText).toISOString() : undefined,
    }))
  })

  return sortDesc(items)
}
