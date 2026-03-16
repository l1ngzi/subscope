import * as cheerio from 'cheerio'
import { hash, item, sortDesc } from '../../lib.ts'
import type { Source, FeedItem } from '../../types.ts'

// Skip static/tutorial articles
const SKIP = new Set([
  'release-notes', 'how-to-get-support',
  'usage-limit-best-practices', 'how-do-usage-and-length-limits-work',
])

// Collection page: scrape article links, fetch each for date
export const fetchSupportCollection = async (source: Source): Promise<FeedItem[]> => {
  const $ = cheerio.load(await fetch(source.url).then(r => r.text()))
  const urls: { url: string; title: string }[] = []
  const seen = new Set<string>()

  $('a[href*="/articles/"]').each((_, el) => {
    const href = $(el).attr('href')
    const title = $(el).text().trim().replace(/\s+/g, ' ')
    if (!href || !title || title.length < 5) return
    const slug = href.split('/').pop() ?? ''
    if (SKIP.has(slug.replace(/^\d+-/, ''))) return
    const fullUrl = href.startsWith('http') ? href : `https://support.claude.com${href}`
    if (seen.has(fullUrl)) return
    seen.add(fullUrl)
    urls.push({ url: fullUrl, title })
  })

  const items = await Promise.all(
    urls.map(async ({ url, title }) => {
      const date = await fetchArticleDate(url)
      return item(source, url, title, { publishedAt: date })
    })
  )

  return sortDesc(items)
}

// Intercom article pages contain lastUpdatedISO in embedded JSON
const fetchArticleDate = async (url: string): Promise<string> => {
  try {
    const html = await fetch(url).then(r => r.text())
    const match = html.match(/lastUpdatedISO.{3,5}?(\d{4}-\d{2}-\d{2}T[\d:.]+Z)/)
    if (match) return match[1]!
  } catch {}
  return new Date().toISOString()
}

// Release notes page: <h3>Date</h3> followed by <p><b>Title</b></p>
export const fetchReleaseNotes = async (source: Source): Promise<FeedItem[]> => {
  const $ = cheerio.load(await fetch(source.url).then(r => r.text()))
  const items: FeedItem[] = []
  const seen = new Set<string>()

  $('h3').each((_, el) => {
    const dateText = $(el).text().trim()
    if (!/^[A-Z][a-z]+ \d{1,2}, \d{4}$/.test(dateText)) return

    let next = $(el).parent().next()
    while (next.length) {
      const bold = next.find('b, strong').first().text().trim()
      if (!bold || next.find('h3').length) break

      const key = `${dateText}-${bold}`
      if (!seen.has(key)) {
        seen.add(key)
        items.push(item(source, source.url, bold, {
          key, publishedAt: new Date(dateText).toISOString(),
        }))
      }
      next = next.next()
    }
  })

  return sortDesc(items)
}
