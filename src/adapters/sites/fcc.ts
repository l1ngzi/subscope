import * as cheerio from 'cheerio'
import { item, sortDesc, fetchWithCffi } from '../../lib.ts'
import type { Source, FeedItem } from '../../types.ts'

// FCC headlines page behind Akamai geo-block. cffi bypasses it.
// Article pages on fcc.gov are also blocked, but docs.fcc.gov serves
// the same content as plain text — we prefer those links when available.
export const fetchFCC = async (source: Source): Promise<FeedItem[]> => {
  const $ = cheerio.load(await fetchWithCffi(source.url))
  const items: FeedItem[] = []
  const seen = new Set<string>()

  $('.headline-item').each((_, el) => {
    const $el = $(el)
    const title = $el.find('.headline-title a').first().text().trim()
      .replace(/\s+/g, ' ')
    if (!title || title.length < 10 || title.length > 300) return
    if (/^(News Release|Memorandum Opinion and Order|\w+ Statement)$/i.test(title)) return

    // Prefer docs.fcc.gov TXT, then PDF, then /document/ page link
    const txtHref = $el.find('a[href$=".txt"]').attr('href')
    const pdfHref = $el.find('a[href$=".pdf"]').attr('href')
    const docHref = $el.find('.headline-title a').attr('href')
    const url = txtHref || pdfHref || (docHref?.startsWith('http') ? docHref : `https://www.fcc.gov${docHref}`)
    if (!url) return

    if (seen.has(url)) return
    seen.add(url)

    // Parse date from .edoc__release-dt
    const dateText = $el.find('.edoc__release-dt').text().trim()
    const publishedAt = dateText ? new Date(dateText).toISOString() : undefined

    items.push(item(source, url, title, { publishedAt }))
  })

  return sortDesc(items)
}
