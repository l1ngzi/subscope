import * as cheerio from 'cheerio'
import { item, sortDesc, UA, TLS } from '../../lib.ts'
import type { Source, FeedItem } from '../../types.ts'

const BASE = 'https://www.ftc.gov'

export const fetchFTC = async (source: Source): Promise<FeedItem[]> => {
  const res = await fetch(source.url, { headers: { 'User-Agent': UA }, ...TLS(source.url) } as any)
  if (!res.ok) throw new Error(`FTC: ${res.status}`)
  const $ = cheerio.load(await res.text())
  const items: FeedItem[] = []
  const seen = new Set<string>()

  $('article.node--type-press-release').each((_, el) => {
    const $a = $(el).find('h3.node-title a')
    const title = $a.text().trim()
    const href = $a.attr('href')
    if (!title || !href) return

    const url = href.startsWith('http') ? href : `${BASE}${href}`
    if (seen.has(url)) return
    seen.add(url)

    const datetime = $(el).find('time[datetime]').attr('datetime')
    const publishedAt = datetime ? new Date(datetime).toISOString() : undefined

    items.push(item(source, url, title, { publishedAt }))
  })

  return sortDesc(items)
}
