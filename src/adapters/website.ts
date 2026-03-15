import * as cheerio from 'cheerio'
import { createHash } from 'crypto'
import type { Source, FeedItem, SourceAdapter } from '../types.ts'

const hash = (...parts: string[]) =>
  createHash('sha256').update(parts.join(':')).digest('hex').slice(0, 12)

export const website: SourceAdapter = {
  type: 'website',
  test: () => true,

  async fetch(source: Source): Promise<FeedItem[]> {
    const res = await globalThis.fetch(source.url, { tls: { rejectUnauthorized: false } } as any)
    const text = await res.text()
    const contentType = res.headers.get('content-type') ?? ''

    // If the URL itself is an RSS/Atom feed, parse directly
    const isXml = contentType.includes('xml') || contentType.includes('rss') || contentType.includes('atom')
    const looksLikeFeed = text.trimStart().startsWith('<?xml') || text.trimStart().startsWith('<rss') || text.trimStart().startsWith('<feed')

    if (isXml || looksLikeFeed) {
      return parseFeed(text, source)
    }

    const $ = cheerio.load(text)

    const feedUrl =
      $('link[type="application/rss+xml"]').attr('href') ??
      $('link[type="application/atom+xml"]').attr('href')

    if (feedUrl) {
      const resolved = new URL(feedUrl, source.url).href
      return fetchFeed(resolved, source)
    }

    return scrapeHTML($, source)
  },
}

const parseFeed = (xml: string, source: Source): FeedItem[] => {
  const $ = cheerio.load(xml, { xml: true })
  return $('item, entry')
    .map((_, el) => {
      const title = $(el).find('title').first().text().trim()
      const link =
        $(el).find('link').attr('href') ?? $(el).find('link').first().text().trim()
      const summary = $(el).find('description, summary').first().text().trim().slice(0, 200)
      const date = ($(el).find('pubDate, published, updated').first().text().trim()
        || $(el).find('dc\\:date').first().text().trim()
        || $(el).find('date').first().text().trim())

      if (!title || !link) return null

      return {
        id: hash(source.id, link),
        sourceId: source.id,
        sourceType: source.type,
        sourceName: source.name,
        title,
        url: link,
        summary: summary || undefined,
        publishedAt: date ? new Date(date).toISOString() : new Date().toISOString(),
      } satisfies FeedItem
    })
    .get()
    .filter(Boolean) as FeedItem[]
}

const fetchFeed = async (feedUrl: string, source: Source): Promise<FeedItem[]> => {
  const xml = await globalThis.fetch(feedUrl, { tls: { rejectUnauthorized: false } } as any).then(r => r.text())
  return parseFeed(xml, source)
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
    try {
      url = new URL(href, baseUrl).href
    } catch {
      return
    }

    if (new URL(url).hostname !== baseUrl.hostname) return
    if (url === source.url) return
    if (seen.has(url)) return
    seen.add(url)

    items.push({
      id: hash(source.id, url),
      sourceId: source.id,
      sourceType: 'website',
      sourceName: source.name,
      title,
      url,
      publishedAt: new Date().toISOString(),
    })
  })

  return items
}
