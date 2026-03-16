import * as cheerio from 'cheerio'
import { item, sortDesc, UA, TLS } from '../../lib.ts'
import type { Source, FeedItem } from '../../types.ts'

const BASE = 'https://www.iaea.org'

export const fetchIAEA = async (source: Source): Promise<FeedItem[]> => {
  const res = await fetch(source.url, { headers: { 'User-Agent': UA }, ...TLS(source.url) } as any)
  if (!res.ok) throw new Error(`IAEA: ${res.status}`)
  const $ = cheerio.load(await res.text())
  const items: FeedItem[] = []
  const seen = new Set<string>()

  // Press releases: h3.card__title > a[href*="pressreleases/"]
  $('h3.card__title a[href*="/newscenter/pressreleases/"]').each((_, el) => {
    const $a = $(el)
    const title = $a.text().trim()
    const href = $a.attr('href')
    if (!title || !href) return

    const url = href.startsWith('http') ? href : `${BASE}${href}`
    if (seen.has(url)) return
    seen.add(url)

    // Date from sibling .card__date
    const dateText = $a.closest('.card').find('.card__date, time').first().text().trim()
    const dateMatch = dateText.match(/(\d{4})-(\d{2})-(\d{2})/) || dateText.match(/(\d{1,2})\s+(\w+)\s+(\d{4})/)

    let publishedAt: string | undefined
    if (dateMatch && dateMatch[0].includes('-')) {
      publishedAt = new Date(`${dateMatch[0]}T00:00:00Z`).toISOString()
    }

    items.push(item(source, url, title, { publishedAt }))
  })

  return sortDesc(items)
}
