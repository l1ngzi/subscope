import * as cheerio from 'cheerio'
import { createHash } from 'crypto'
import type { Source, FeedItem } from '../../types.ts'

const hash = (...parts: string[]) =>
  createHash('sha256').update(parts.join(':')).digest('hex').slice(0, 12)

const BASE = 'https://api-docs.deepseek.com'

// DeepSeek changelog/updates page — sidebar has dated release links

export const fetchDeepSeek = async (source: Source): Promise<FeedItem[]> => {
  const html = await fetch(source.url).then(r => r.text())
  const $ = cheerio.load(html)
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

    const url = `${BASE}${href}`
    items.push({
      id: hash(source.id, href),
      sourceId: source.id,
      sourceType: 'website',
      sourceName: source.name,
      title,
      url,
      publishedAt: dateMatch
        ? new Date(dateMatch[1]!.replace(/\//g, '-')).toISOString()
        : new Date().toISOString(),
    })
  })

  return items.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
}
