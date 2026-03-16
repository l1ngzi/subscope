import * as cheerio from 'cheerio'
import { item, sortDesc, UA } from '../../lib.ts'
import type { Source, FeedItem } from '../../types.ts'

const BASE = 'http://world.people.com.cn'

export const fetchPeople = async (source: Source): Promise<FeedItem[]> => {
  const res = await fetch(source.url, { headers: { 'User-Agent': UA } })
  const $ = cheerio.load(await res.text())
  const items: FeedItem[] = []
  const seen = new Set<string>()

  $('a[href*="/n1/"]').each((_, el) => {
    const $a = $(el)
    const title = $a.text().trim()
    const href = $a.attr('href')
    if (!title || !href || title.length < 4) return

    const url = href.startsWith('http') ? href : `${BASE}${href}`
    if (seen.has(url)) return
    seen.add(url)

    // Date from URL path: /n1/2026/0316/c1002-40682785.html
    const dateMatch = url.match(/\/n1\/(\d{4})\/(\d{2})(\d{2})\//)
    const publishedAt = dateMatch
      ? new Date(`${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}T00:00:00+08:00`).toISOString()
      : undefined

    items.push(item(source, url, title, { publishedAt }))
  })

  return sortDesc(items)
}
