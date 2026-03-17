import * as cheerio from 'cheerio'
import { item, sortDesc, fetchWithCffi } from '../../lib.ts'
import type { Source, FeedItem } from '../../types.ts'

const BASE = 'https://www.oecd.org'

// OECD: Cloudflare blocks most TLS fingerprints; chrome120 via curl_cffi passes
export const fetchOECD = async (source: Source): Promise<FeedItem[]> => {
  const $ = cheerio.load(await fetchWithCffi(source.url, 'chrome120'))
  const items: FeedItem[] = []
  const seen = new Set<string>()

  const parseDate = (text: string): string | undefined => {
    try { return new Date(text.trim()).toISOString() } catch {}
  }

  // Featured cards: a.cmp-featured-card__link + .cmp-featured-card__date
  $('a.cmp-featured-card__link').each((_, el) => {
    const $a = $(el)
    const href = $a.attr('href')
    if (!href || !href.includes('/en/about/news/')) return

    const title = $a.text().trim()
    if (!title || title.length < 10) return

    const url = href.startsWith('http') ? href : `${BASE}${href}`
    if (seen.has(url)) return
    seen.add(url)

    const dateText = $a.closest('.cmp-featured-card__content, .cmp-featured-card')
      .find('.cmp-featured-card__date').text()
    const publishedAt = parseDate(dateText) ?? dateFromUrl(href)

    items.push(item(source, url, title, { publishedAt }))
  })

  // Regular cards: a.card__title-link + .card__date
  $('a.card__title-link').each((_, el) => {
    const $a = $(el)
    const href = $a.attr('href')
    if (!href || !href.includes('/en/about/news/')) return

    const title = $a.text().trim()
    if (!title || title.length < 10) return

    const url = href.startsWith('http') ? href : `${BASE}${href}`
    if (seen.has(url)) return
    seen.add(url)

    const dateText = $a.closest('.card').find('.card__date').text()
    const publishedAt = parseDate(dateText) ?? dateFromUrl(href)

    items.push(item(source, url, title, { publishedAt }))
  })

  return sortDesc(items)
}

/** Extract approximate date from URL path: /YYYY/MM/slug.html → mid-month */
const dateFromUrl = (href: string): string | undefined => {
  const m = href.match(/\/(\d{4})\/(\d{2})\//)
  if (!m) return
  try { return new Date(`${m[1]}-${m[2]}-15T12:00:00Z`).toISOString() } catch {}
}
