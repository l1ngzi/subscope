import * as cheerio from 'cheerio'
import { createHash } from 'crypto'
import type { Source, FeedItem } from '../../types.ts'

const hash = (...parts: string[]) =>
  createHash('sha256').update(parts.join(':')).digest('hex').slice(0, 12)

const BASE = 'https://www.stats.gov.cn'

export const fetchNBS = async (source: Source): Promise<FeedItem[]> => {
  const res = await fetch(source.url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    tls: { rejectUnauthorized: false },
  } as any)
  const text = await res.text()

  if (source.url.endsWith('.xml') || text.trimStart().startsWith('<?xml')) {
    return parseRSS(text, source)
  }
  return parseHTML(text, source)
}

// RSS at /sj/zxfb/rss.xml — pubDate format: "2026-03-14 09:30:00"
const parseRSS = (xml: string, source: Source): FeedItem[] => {
  const $ = cheerio.load(xml, { xml: true })
  return $('item')
    .map((_, el) => {
      const title = $(el).find('title').first().text().trim()
      const link = $(el).find('link').first().text().trim()
      const desc = $(el).find('description').first().text().trim()
      const dateStr = $(el).find('pubDate').first().text().trim()
      if (!title || !link) return null
      return {
        id: hash(source.id, link),
        sourceId: source.id,
        sourceType: 'website' as const,
        sourceName: source.name,
        title,
        url: link,
        summary: desc ? desc.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 200) : undefined,
        publishedAt: parseDate(dateStr),
      }
    })
    .get()
    .filter(Boolean) as FeedItem[]
}

// HTML at /sj/zxfb/ — <li><a href="./YYYYMM/t...html" title="...">...</a><span>YYYY-MM-DD</span></li>
const parseHTML = (html: string, source: Source): FeedItem[] => {
  const $ = cheerio.load(html)
  const items: FeedItem[] = []

  $('div.list-content li').each((_, el) => {
    const $a = $(el).find('a.pc_1600').first()
    if (!$a.length) return
    const title = $a.attr('title') || $a.text().trim()
    const href = $a.attr('href')
    const dateText = $(el).find('span').first().text().trim()
    if (!title || !href) return

    const url = href.startsWith('http') ? href : new URL(href, source.url).href

    items.push({
      id: hash(source.id, url),
      sourceId: source.id,
      sourceType: 'website',
      sourceName: source.name,
      title,
      url,
      publishedAt: parseDate(dateText),
    })
  })

  return items.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
}

// "2026-03-14 09:30:00" → ISO with +08:00
const parseDate = (s: string): string => {
  if (!s) return new Date().toISOString()
  // "YYYY-MM-DD HH:MM:SS" → "YYYY-MM-DDTHH:MM:SS+08:00"
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) {
    return new Date(s.replace(' ', 'T') + '+08:00').toISOString()
  }
  // "YYYY-MM-DD"
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return new Date(s + 'T00:00:00+08:00').toISOString()
  }
  try { return new Date(s).toISOString() } catch { return new Date().toISOString() }
}
