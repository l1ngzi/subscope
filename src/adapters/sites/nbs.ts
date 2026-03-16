import * as cheerio from 'cheerio'
import { item, sortDesc, UA, TLS } from '../../lib.ts'
import type { Source, FeedItem } from '../../types.ts'

export const fetchNBS = async (source: Source): Promise<FeedItem[]> => {
  const res = await fetch(source.url, { headers: { 'User-Agent': UA }, ...TLS(source.url) } as any)
  const text = await res.text()

  if (source.url.endsWith('.xml') || text.trimStart().startsWith('<?xml')) {
    return parseRSS(text, source)
  }
  return parseHTML(text, source)
}

// RSS at /sj/zxfb/rss.xml
const parseRSS = (xml: string, source: Source): FeedItem[] => {
  const $ = cheerio.load(xml, { xml: true })
  return $('item').map((_, el) => {
    const title = $(el).find('title').first().text().trim()
    const link = $(el).find('link').first().text().trim()
    if (!title || !link) return null
    const desc = $(el).find('description').first().text().trim()
    return item(source, link, title, {
      summary: desc ? desc.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 200) : undefined,
      publishedAt: parseDate($(el).find('pubDate').first().text().trim()),
    })
  }).get().filter(Boolean) as FeedItem[]
}

// HTML at /sj/zxfb/
const parseHTML = (html: string, source: Source): FeedItem[] => {
  const $ = cheerio.load(html)
  const items: FeedItem[] = []

  $('div.list-content li').each((_, el) => {
    const $a = $(el).find('a.pc_1600').first()
    if (!$a.length) return
    const title = $a.attr('title') || $a.text().trim()
    const href = $a.attr('href')
    if (!title || !href) return

    const url = href.startsWith('http') ? href : new URL(href, source.url).href
    items.push(item(source, url, title, {
      publishedAt: parseDate($(el).find('span').first().text().trim()),
    }))
  })

  return sortDesc(items)
}

// "2026-03-14 09:30:00" → ISO with +08:00
const parseDate = (s: string): string => {
  if (!s) return new Date().toISOString()
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s))
    return new Date(s.replace(' ', 'T') + '+08:00').toISOString()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s))
    return new Date(s + 'T00:00:00+08:00').toISOString()
  try { return new Date(s).toISOString() } catch { return new Date().toISOString() }
}
