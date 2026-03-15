import * as cheerio from 'cheerio'
import { createHash } from 'crypto'
import type { Source, FeedItem } from '../../types.ts'

const hash = (...parts: string[]) =>
  createHash('sha256').update(parts.join(':')).digest('hex').slice(0, 12)

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
}

// Parse the BLS RSS feed — one giant <item> with all indicators in HTML
export const fetchBLS = async (source: Source): Promise<FeedItem[]> => {
  const res = await fetch(source.url, { headers: HEADERS })
  if (!res.ok) throw new Error(`BLS: ${res.status}`)
  const xml = await res.text()
  const $ = cheerio.load(xml, { xml: true })

  const desc = $('item description').first().text()
  const $html = cheerio.load(desc)
  const items: FeedItem[] = []

  $html('p').each((_, el) => {
    const $p = $html(el)
    const text = $p.text().replace(/\s+/g, ' ').trim()
    if (!text) return

    // Extract indicator name and value from "Name: +0.3% in Feb 2026"
    const match = text.match(/^(.+?):\s*(.+?\d{4})/)
    if (!match) return

    const name = match[1]!.trim()
    const value = match[2]!.trim()

    // Extract the news release link
    const newsLink = $p.find('a[href*="news.release"]').attr('href')
    const url = newsLink
      ? (newsLink.startsWith('http') ? newsLink : `https://www.bls.gov${newsLink}`)
      : 'https://www.bls.gov/bls/newsrels.htm'

    // Extract date from value like "+0.3% in Feb 2026" or "4.4% in Feb 2026"
    const dateMatch = value.match(/(?:in|of)\s+(\w+\.?\s+(?:Qtr\s+(?:of\s+)?)?\d{4})/)
    const publishedAt = dateMatch ? parseBlsDate(dateMatch[1]!) : new Date().toISOString()

    items.push({
      id: hash(source.id, name, value),
      sourceId: source.id,
      sourceType: 'website',
      sourceName: source.name,
      title: `${name}: ${value}`,
      url,
      publishedAt,
    })
  })

  return items.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
}

// "Feb 2026" or "4th Qtr of 2025" → ISO date
const parseBlsDate = (s: string): string => {
  const months: Record<string, number> = {
    Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
    Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
  }
  // "Feb 2026"
  const monthMatch = s.match(/(\w{3})\.?\s+(\d{4})/)
  if (monthMatch) {
    const m = months[monthMatch[1]!]
    if (m !== undefined) return new Date(+monthMatch[2]!, m, 15).toISOString()
  }
  // "4th Qtr of 2025"
  const qtrMatch = s.match(/(\d)\w*\s+Qtr.*?(\d{4})/)
  if (qtrMatch) {
    const q = +qtrMatch[1]!
    return new Date(+qtrMatch[2]!, (q - 1) * 3 + 1, 15).toISOString()
  }
  return new Date().toISOString()
}
