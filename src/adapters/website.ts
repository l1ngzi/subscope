import * as cheerio from 'cheerio'
import { hash, item, TLS } from '../lib.ts'
import type { Source, FeedItem, SourceAdapter } from '../types.ts'

export const website: SourceAdapter = {
  type: 'website',
  test: () => true,

  async fetch(source: Source): Promise<FeedItem[]> {
    const res = await globalThis.fetch(source.url, TLS(source.url) as any)
    const text = await res.text()
    const contentType = res.headers.get('content-type') ?? ''

    const isXml = contentType.includes('xml') || contentType.includes('rss') || contentType.includes('atom')
    const looksLikeFeed = text.trimStart().startsWith('<?xml') || text.trimStart().startsWith('<rss') || text.trimStart().startsWith('<feed')

    if (isXml || looksLikeFeed) return parseFeed(text, source)

    const $ = cheerio.load(text)
    const feedUrl =
      $('link[type="application/rss+xml"]').attr('href') ??
      $('link[type="application/atom+xml"]').attr('href')

    if (feedUrl) {
      const resolved = new URL(feedUrl, source.url).href
      const xml = await globalThis.fetch(resolved, TLS(resolved) as any).then(r => r.text())
      return parseFeed(xml, source)
    }

    return scrapeHTML($, source)
  },
}

const parseFeed = (xml: string, source: Source): FeedItem[] => {
  const $ = cheerio.load(xml, { xml: true })
  return $('item, entry').map((_, el) => {
    const title = $(el).find('title').first().text().trim()
    const link = $(el).find('link').attr('href') ?? $(el).find('link').first().text().trim()
    if (!title || !link) return null

    const summary = $(el).find('description, summary').first().text().trim().slice(0, 200)
    const date = $(el).find('pubDate, published, updated').first().text().trim()
      || $(el).find('dc\\:date').first().text().trim()
      || $(el).find('date').first().text().trim()

    return item(source, link, title, {
      summary: summary || undefined,
      publishedAt: date ? new Date(date).toISOString() : undefined,
    })
  }).get().filter(Boolean) as FeedItem[]
}

const scrapeHTML = ($: cheerio.CheerioAPI, source: Source): FeedItem[] => {
  const baseUrl = new URL(source.url)
  const seen = new Set<string>()
  const items: FeedItem[] = []

  $('a[href]').each((_, el) => {
    const $el = $(el)
    const href = $el.attr('href')
    if (!href) return

    const title = $el.text().trim().replace(/\s+/g, ' ')
    if (title.length < 10) return

    let url: string
    try { url = new URL(href, baseUrl).href } catch { return }
    if (new URL(url).hostname !== baseUrl.hostname) return
    if (url === source.url || seen.has(url)) return
    seen.add(url)

    items.push(item(source, url, title))
  })

  return items
}
