import * as cheerio from 'cheerio'
import { item, sortDesc, UA, TLS } from '../../lib.ts'
import type { Source, FeedItem } from '../../types.ts'

const BASE = 'https://www.bea.gov'

export const fetchBEA = async (source: Source): Promise<FeedItem[]> => {
  const $ = cheerio.load(
    await fetch(source.url, { headers: { 'User-Agent': UA }, ...TLS } as any).then(r => r.text())
  )
  const items: FeedItem[] = []

  $('tr.release-row').each((_, el) => {
    const $a = $(el).find('a[href^="/news/"]')
    const title = $a.text().trim()
    const href = $a.attr('href')
    if (!title || !href) return

    items.push(item(source, `${BASE}${href}`, title, {
      publishedAt: $(el).find('time').attr('datetime')
        ? new Date($(el).find('time').attr('datetime')!).toISOString()
        : undefined,
    }))
  })

  return sortDesc(items)
}
