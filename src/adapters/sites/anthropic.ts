import * as cheerio from 'cheerio'
import { item, sortDesc } from '../../lib.ts'
import type { Source, FeedItem } from '../../types.ts'

const BASE = 'https://www.anthropic.com'

// Fetches all three sections (blog, research, engineering) in parallel.
export const fetchAnthropic = async (source: Source): Promise<FeedItem[]> => {
  const [blogHtml, researchHtml, engHtml] = await Promise.all([
    fetch(`${BASE}/blog`).then(r => r.text()),
    fetch(`${BASE}/research`).then(r => r.text()),
    fetch(`${BASE}/engineering`).then(r => r.text()),
  ])

  return sortDesc([
    ...parseRSC(blogHtml, source, '/blog'),
    ...parseRSC(researchHtml, source, '/research'),
    ...parseEngineering(engHtml, source),
  ])
}

// /blog, /research: data lives in RSC JSON payload
const parseRSC = (html: string, source: Source, path: string): FeedItem[] => {
  const items: FeedItem[] = []
  const seen = new Set<string>()
  const pathPrefix = path === '/research' ? '/research/' : '/news/'

  let pos = 0
  while ((pos = html.indexOf('publishedOn', pos + 1)) !== -1) {
    const window = html.slice(pos, pos + 1500)

    // RSC payload: publishedOn followed by ISO date within a few chars
    const date = window.match(/publishedOn.{3,6}?(\d{4}-\d{2}-\d{2}T[\d:.]+Z)/)?.[1]
    // slug → current → "the-actual-slug" (RSC nested JSON structure)
    const slug = window.match(/slug.*?current.{3,6}?([\w-]+)/)?.[1]
    // RSC escaped JSON: title\":\""Some Title\""
    const title = window.match(/title\\*":\\*"(.+?)\\*"/)?.[1]
    // summary can be null or an escaped string in the same format
    const summaryMatch = window.match(/summary\\*":(null|\\*"(.+?)\\*")/)
    const summary = summaryMatch?.[1] === 'null' ? undefined : summaryMatch?.[2]

    if (!date || !slug || !title || seen.has(slug)) continue
    seen.add(slug)

    items.push(item(source, `${BASE}${pathPrefix}${slug}`, clean(title), {
      summary: summary ? clean(summary) : undefined,
      publishedAt: new Date(date).toISOString(),
    }))
  }

  return items
}

// /engineering: rendered HTML with <article> elements
const parseEngineering = (html: string, source: Source): FeedItem[] => {
  const $ = cheerio.load(html)
  const seen = new Set<string>()

  const articles: { href: string; title: string; dateText: string; summary: string }[] = []
  $('article a[href^="/engineering/"]').each((_, el) => {
    const $el = $(el)
    const href = $el.attr('href')!
    const title = $el.find('h3').first().text().trim()
    if (!title || seen.has(href)) return
    seen.add(href)
    articles.push({
      href, title,
      dateText: $el.find('[class*="date"]').text().trim(),
      summary: $el.find('p').first().text().trim(),
    })
  })

  // Undated articles get timestamps just after the earliest dated one
  const firstDated = articles.find(a => a.dateText)
  const fallbackBase = firstDated ? new Date(firstDated.dateText).getTime() : Date.now()
  let undatedOffset = 0

  return articles.map(a => {
    const publishedAt = a.dateText
      ? new Date(a.dateText).toISOString()
      : new Date(fallbackBase + ++undatedOffset * 1000).toISOString()
    return item(source, `${BASE}${a.href}`, a.title, {
      summary: a.summary || undefined,
      publishedAt,
    })
  })
}

const clean = (s: string) =>
  s.replace(/\\+"/g, '').replace(/\\+n/g, ' ').replace(/\s+/g, ' ').trim()
