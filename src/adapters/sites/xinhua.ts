import * as cheerio from 'cheerio'
import { item, sortDesc, UA, TLS, dateOnlyToISO } from '../../lib.ts'
import type { Source, FeedItem } from '../../types.ts'

const BASE = 'http://www.news.cn'

// Fetches both world and politics (china) pages in parallel
export const fetchXinhua = async (source: Source): Promise<FeedItem[]> => {
  const paths = ['/world/', '/politics/']
  const seen = new Set<string>()

  const parsePage = async (path: string): Promise<FeedItem[]> => {
    const url = `${BASE}${path}`
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, ...TLS(url) } as any)
      if (!res.ok) return []
      const $ = cheerio.load(await res.text())
      const items: FeedItem[] = []

      $('a[href*="news.cn/"]').each((_, el) => {
        const $a = $(el)
        const href = $a.attr('href')
        if (!href || !href.includes('/c.html')) return

        const title = ($a.attr('title') || $a.text()).trim()
        if (!title || title.length < 4 || title.length > 200) return

        const articleUrl = href.startsWith('http') ? href : `${BASE}${href}`
        if (seen.has(articleUrl)) return
        seen.add(articleUrl)

        const dateMatch = articleUrl.match(/\/(\d{4})(\d{2})(\d{2})\//)
        const publishedAt = dateMatch
          ? dateOnlyToISO(dateMatch[1]!, dateMatch[2]!, dateMatch[3]!)
          : undefined

        items.push(item(source, articleUrl, title, { publishedAt }))
      })
      return items
    } catch { return [] }
  }

  const results = await Promise.all(paths.map(parsePage))
  return sortDesc(results.flat())
}
