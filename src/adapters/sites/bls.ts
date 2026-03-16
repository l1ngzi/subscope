import * as cheerio from 'cheerio'
import { item, sortDesc } from '../../lib.ts'
import type { Source, FeedItem } from '../../types.ts'

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
}

// BLS RSS feed — one giant <item> with all indicators in HTML
export const fetchBLS = async (source: Source): Promise<FeedItem[]> => {
  const res = await fetch(source.url, { headers: HEADERS })
  if (!res.ok) throw new Error(`BLS: ${res.status}`)
  const $ = cheerio.load(await res.text(), { xml: true })

  const $html = cheerio.load($('item description').first().text())
  const items: FeedItem[] = []

  $html('p').each((_, el) => {
    const text = $html(el).text().replace(/\s+/g, ' ').trim()
    if (!text) return

    // "Consumer Price Index: rose 0.4% in Feb 2026" → [name, value+date]
    const match = text.match(/^(.+?):\s*(.+?\d{4})/)
    if (!match) return

    const name = match[1]!.trim()
    const value = match[2]!.trim()

    const newsLink = $html(el).find('a[href*="news.release"]').attr('href')
    const url = newsLink
      ? (newsLink.startsWith('http') ? newsLink : `https://www.bls.gov${newsLink}`)
      : 'https://www.bls.gov/bls/newsrels.htm'

    // Extract date: "in Feb. 2026" or "of 4th Qtr of 2025"
    const dateMatch = value.match(/(?:in|of)\s+(\w+\.?\s+(?:Qtr\s+(?:of\s+)?)?\d{4})/)

    items.push(item(source, url, `${name}: ${value}`, {
      key: `${name}:${value}`,
      publishedAt: dateMatch ? parseBlsDate(dateMatch[1]!) : undefined,
    }))
  })

  return sortDesc(items)
}

// "Feb 2026" or "4th Qtr of 2025" → ISO date
const parseBlsDate = (s: string): string => {
  const months: Record<string, number> = {
    Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
    Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
  }
  const monthMatch = s.match(/(\w{3})\.?\s+(\d{4})/)
  if (monthMatch) {
    const m = months[monthMatch[1]!]
    if (m !== undefined) return new Date(+monthMatch[2]!, m, 15).toISOString()
  }
  const qtrMatch = s.match(/(\d)\w*\s+Qtr.*?(\d{4})/)
  if (qtrMatch) {
    const q = +qtrMatch[1]!
    return new Date(+qtrMatch[2]!, (q - 1) * 3 + 1, 15).toISOString()
  }
  return new Date().toISOString()
}
