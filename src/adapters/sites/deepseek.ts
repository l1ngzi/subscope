import * as cheerio from 'cheerio'
import { item, sortDesc } from '../../lib.ts'
import type { Source, FeedItem } from '../../types.ts'

const BASE = 'https://api-docs.deepseek.com'

export const fetchDeepSeek = async (source: Source): Promise<FeedItem[]> => {
  const $ = cheerio.load(await fetch(source.url).then(r => r.text()))
  const items: FeedItem[] = []
  const seen = new Set<string>()

  $('a[href^="/news/"]').each((_, el) => {
    const href = $(el).attr('href')!
    const raw = $(el).text().trim()
    if (seen.has(href)) return
    seen.add(href)

    // Format: "DeepSeek-V3.2 Release 2025/12/01"
    const dateMatch = raw.match(/(\d{4}\/\d{2}\/\d{2})/)
    const title = raw.replace(/\d{4}\/\d{2}\/\d{2}/, '').trim()
    if (!title || title.length < 5 || !dateMatch) return

    items.push(item(source, `${BASE}${href}`, title, {
      key: href,
      publishedAt: new Date(dateMatch[1]!.replace(/\//g, '-')).toISOString(),
    }))
  })

  return sortDesc(items)
}
