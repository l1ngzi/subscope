import * as cheerio from 'cheerio'
import { item, sortDesc } from '../../lib.ts'
import type { Source, FeedItem } from '../../types.ts'

const BASE = 'https://www.anthropic.com'

export const fetchAnthropic = async (source: Source): Promise<FeedItem[]> => {
  const html = await fetch(source.url).then(r => r.text())

  if (source.url.includes('/engineering')) {
    return parseEngineering(html, source)
  }
  return parseRSC(html, source)
}

// /blog, /research: data lives in RSC JSON payload
const parseRSC = (html: string, source: Source): FeedItem[] => {
  const items: FeedItem[] = []
  const seen = new Set<string>()
  const pathPrefix = source.url.includes('/research') ? '/research/' : '/news/'

  let pos = 0
  while ((pos = html.indexOf('publishedOn', pos + 1)) !== -1) {
    const window = html.slice(pos, pos + 1500)

    const date = window.match(/publishedOn.{3,6}?(\d{4}-\d{2}-\d{2}T[\d:.]+Z)/)?.[1]
    const slug = window.match(/slug.*?current.{3,6}?([\w-]+)/)?.[1]
    const title = window.match(/title\\*":\\*"(.+?)\\*"/)?.[1]
    const summaryMatch = window.match(/summary\\*":(null|\\*"(.+?)\\*")/)
    const summary = summaryMatch?.[1] === 'null' ? undefined : summaryMatch?.[2]

    if (!date || !slug || !title || seen.has(slug)) continue
    seen.add(slug)

    items.push(item(source, `${BASE}${pathPrefix}${slug}`, clean(title), {
      summary: summary ? clean(summary) : undefined,
      publishedAt: new Date(date).toISOString(),
    }))
  }

  return sortDesc(items)
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

  return sortDesc(articles.map(a => {
    const publishedAt = a.dateText
      ? new Date(a.dateText).toISOString()
      : new Date(fallbackBase + ++undatedOffset * 1000).toISOString()
    return item(source, `${BASE}${a.href}`, a.title, {
      summary: a.summary || undefined,
      publishedAt,
    })
  }))
}

const clean = (s: string) =>
  s.replace(/\\+"/g, '').replace(/\\+n/g, ' ').replace(/\s+/g, ' ').trim()
