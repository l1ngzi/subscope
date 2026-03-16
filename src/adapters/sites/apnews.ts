import * as cheerio from 'cheerio'
import { item, sortDesc, UA } from '../../lib.ts'
import type { Source, FeedItem } from '../../types.ts'

const BASE = 'https://apnews.com'

const MONTHS: Record<string, string> = {
  january: '01', february: '02', march: '03', april: '04',
  may: '05', june: '06', july: '07', august: '08',
  september: '09', october: '10', november: '11', december: '12',
}

// Extract date from AP News URL slug: "...-march-16-2026-{hash}"
const dateFromSlug = (url: string): string | undefined => {
  const m = url.match(/-([a-z]+)-(\d{1,2})-(\d{4})-[a-f0-9]{10,}$/)
  if (!m) return undefined
  const mm = MONTHS[m[1]!]
  if (!mm) return undefined
  const dd = m[2]!.padStart(2, '0')
  try { return new Date(`${m[3]}-${mm}-${dd}T12:00:00Z`).toISOString() } catch { return undefined }
}

export const fetchAPNews = async (source: Source): Promise<FeedItem[]> => {
  const res = await fetch(source.url, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`AP News: ${res.status}`)
  const $ = cheerio.load(await res.text())

  const items: FeedItem[] = []
  const seen = new Set<string>()

  $('a[href*="/article/"]').each((_, el) => {
    const href = $(el).attr('href')!
    const url = href.startsWith('http') ? href : `${BASE}${href}`
    if (seen.has(url)) return
    seen.add(url)

    const title = $(el).find('h2, h3, [class*="CardHeadline"]').text().trim()
      || $(el).text().trim()
    if (!title || title.length < 10) return

    items.push(item(source, url, title, { publishedAt: dateFromSlug(url) }))
  })

  return sortDesc(items).slice(0, 30)
}
