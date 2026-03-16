import * as cheerio from 'cheerio'
import { item, sortDesc, UA, TLS, retry } from '../../lib.ts'
import { fetchWithBrowser } from '../../browser.ts'
import type { Source, FeedItem } from '../../types.ts'

const BASE = 'https://www.imf.org'

export const fetchIMF = async (source: Source): Promise<FeedItem[]> => {
  let html: string
  try {
    html = await retry(async () => {
      const res = await fetch(source.url, {
        headers: {
          'User-Agent': UA,
          'Sec-Fetch-Dest': 'document', 'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none', 'Sec-Fetch-User': '?1',
        },
        ...TLS(source.url),
      } as any)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const text = await res.text()
      if (!text.includes('/news/articles/')) throw new Error('blocked')
      return text
    }, 3, 500)
  } catch {
    html = fetchWithBrowser(source.url)
  }

  const $ = cheerio.load(html)
  const items: FeedItem[] = []
  const seen = new Set<string>()

  $('div.link-list--news li a[href*="/news/articles/"]').each((_, el) => {
    const $a = $(el)
    const href = $a.attr('href')
    if (!href) return

    const dateText = $a.find('span').first().text().trim()
    const title = $a.text().replace(dateText, '').trim()
    if (!title) return

    const url = href.startsWith('http') ? href : `${BASE}${href}`
    if (seen.has(url)) return
    seen.add(url)

    items.push(item(source, url, title, {
      publishedAt: dateText ? new Date(dateText).toISOString() : undefined,
    }))
  })

  return sortDesc(items)
}
