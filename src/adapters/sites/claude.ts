import * as cheerio from 'cheerio'
import { item, sortDesc } from '../../lib.ts'
import type { Source, FeedItem } from '../../types.ts'

const BASE = 'https://www.claude.com'

export const fetchClaude = async (source: Source): Promise<FeedItem[]> => {
  const $ = cheerio.load(await fetch(source.url).then(r => r.text()))
  const items: FeedItem[] = []
  const seen = new Set<string>()

  $('article').each((_, el) => {
    const $el = $(el)
    const href = $el.find('a[href^="/blog/"]').first().attr('href')
    const title = $el.find('h3').first().text().trim()
    if (!href || !title || seen.has(href)) return
    seen.add(href)

    // Date lives in a div whose own text matches "Month DD, YYYY"
    let dateText = ''
    $el.find('div').each((_, d) => {
      const own = $(d).clone().children().remove().end().text().trim()
      if (/^[A-Z][a-z]+ \d{1,2}, \d{4}$/.test(own)) dateText = own
    })

    items.push(item(source, `${BASE}${href}`, title, {
      publishedAt: dateText ? new Date(dateText).toISOString() : undefined,
    }))
  })

  return sortDesc(items)
}
