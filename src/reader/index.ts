import * as cheerio from 'cheerio'
import { UA, TLS, findFirst, retry } from '../lib.ts'
import { fetchWithBrowser } from '../browser.ts'
import type { SiteRule } from './types.ts'
import { econRules } from './econ.ts'
import { newsRules } from './news.ts'
import { aiRules } from './ai.ts'

const SITES: SiteRule[] = [...econRules, ...newsRules, ...aiRules]

export const readArticle = async (url: string): Promise<{ title: string; text: string }> => {
  // SEC EDGAR: filing index → auto-follow to actual document
  if (url.includes('sec.gov') && url.includes('-index.htm')) {
    const resolved = await resolveEdgarDoc(url)
    if (resolved) {
      const result = await readArticle(resolved.docUrl)
      if (resolved.title) result.title = resolved.title
      return result
    }
  }

  const site = SITES.find(s => s.test(url))
  const headers: Record<string, string> = {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8',
    ...site?.headers,
  }

  let html: string
  try {
    // Primary: HTTP with retry ×3
    html = await retry(async () => {
      const res = await fetch(url, { headers, ...TLS(url) } as any)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.text()
    }, 3, 500)
    // Angular SPA: detect unrendered template and retry with Playwright networkidle
    if (html.includes('{{data.') && html.includes('ng-controller')) {
      html = fetchWithBrowser(url, 'networkidle')
    }
  } catch {
    // Fallback 1: RSS feed content
    if (site?.feedUrl) {
      const rss = await readFromFeed(url, site.feedUrl).catch(() => null)
      if (rss) return rss
    }
    // Fallback 2: Playwright ×1
    html = fetchWithBrowser(url)
  }

  const $ = cheerio.load(html)

  // Title — try site-specific selectors, fall back to <title>
  const titleSel = site?.title ?? 'h1, title'
  let title = findFirst($, titleSel)?.text || $('title').text().trim()
  if (site?.cleanTitle) title = site.cleanTitle(title)

  // Body — try site pick function, then selector list, then <body>
  let $body: cheerio.Cheerio<any> | null = site?.pick?.($) ?? null
  if (!$body?.length) {
    const selector = site?.selector ?? 'article, main, .content, .post-body, body'
    $body = findFirst($, selector)?.el ?? null
  }
  if (!$body?.length) $body = $('body')

  // Strip noise
  $body.find('script, style, noscript, nav, footer, .nav, .footer, .sidebar, .breadcrumb, img, svg, iframe, video, .ad, .share, .social, [class*="share"], button').remove()

  // Remove headings duplicating the title
  if (title) {
    const titleNorm = title.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, '')
    $body.find('h1, h2, h3').each((_, el) => {
      const hNorm = $(el).text().trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, '')
      if (hNorm === titleNorm) $(el).remove()
    })
  }

  return { title, text: extractText($body, $) }
}

// ── Table extraction ──

const tableToMarkdown = ($: cheerio.CheerioAPI, node: any): string => {
  const trs = $(node).find('tr').toArray()
  const grid: string[][] = []
  const spanned = new Set<string>()

  for (let r = 0; r < trs.length; r++) {
    if (!grid[r]) grid[r] = []
    let col = 0
    $(trs[r]!).find('th, td').each((_, cell) => {
      while (spanned.has(`${r},${col}`)) col++
      const text = $(cell).text().replace(/\s+/g, ' ').trim()
      const cs = parseInt($(cell).attr('colspan') || '1', 10)
      const rs = parseInt($(cell).attr('rowspan') || '1', 10)
      for (let dr = 0; dr < rs; dr++)
        for (let dc = 0; dc < cs; dc++) {
          if (!grid[r + dr]) grid[r + dr] = []
          grid[r + dr]![col + dc] = (dr === 0 && dc === 0) ? text : ''
          if (dr > 0 || dc > 0) spanned.add(`${r + dr},${col + dc}`)
        }
      col += cs
    })
  }

  const rows = grid.filter(r => r?.some(c => c?.trim()))
  if (!rows.length) return ''
  const cols = Math.max(...rows.map(r => r.length))
  for (const row of rows) { while (row.length < cols) row.push(''); row.splice(cols) }

  // Header/data boundary: first row where >1/3 of cells look numeric
  const isNumeric = (r: string[]) =>
    r.filter(c => /^-?[\d,.]+%?$/.test((c ?? '').replace(/[()p]/g, ''))).length > r.length / 3
  let split = rows.findIndex(isNumeric)
  if (split < 0) split = rows.length > 2 ? 2 : 1

  // Flatten compound headers ("Group: Column")
  const header: string[] = Array(cols).fill('')
  if (split <= 1) {
    for (let c = 0; c < cols; c++) header[c] = (rows[0]![c] ?? '').trim()
  } else {
    const groups: string[] = Array(cols).fill('')
    for (let r = 0; r < split - 1; r++) {
      let span = ''
      for (let c = 0; c < cols; c++) {
        const val = (rows[r]![c] ?? '').trim()
        if (val) span = val
        else if (span && !groups[c]) groups[c] = span
        if (val) groups[c] = val
      }
    }
    const bottom = rows[split - 1]!
    for (let c = 0; c < cols; c++) {
      const sub = (bottom[c] ?? '').trim()
      const grp = groups[c]
      header[c] = sub && grp && sub !== grp ? `${grp}: ${sub}` : sub || grp || ''
    }
  }

  const data = [header, ...rows.slice(split)]
  const widths: number[] = Array(cols).fill(0)
  for (const row of data)
    for (let i = 0; i < row.length; i++)
      widths[i] = Math.max(widths[i]!, (row[i] ?? '').length)

  const fmt = (row: string[]) =>
    '| ' + row.map((c, i) => (c ?? '').padEnd(widths[i]!)).join(' | ') + ' |'
  const sep = '|' + widths.map(w => '-'.repeat(w + 2)).join('|') + '|'

  return '\n' + fmt(data[0]!) + '\n' + sep + '\n' + data.slice(1).map(fmt).join('\n') + '\n\n'
}

// ── Text extraction ──

const extractText = ($el: cheerio.Cheerio<any>, $: cheerio.CheerioAPI): string => {
  const blocks: string[] = []

  const walk = (node: any) => {
    if (node.type === 'text') {
      const t = node.data?.replace(/\s+/g, ' ') ?? ''
      if (t.trim()) blocks.push(t)
      return
    }
    if (node.type !== 'tag') return
    const tag = node.name?.toLowerCase()
    if (['script', 'style', 'nav', 'footer', 'img', 'svg', 'iframe'].includes(tag)) return
    if (tag === 'table') { const md = tableToMarkdown($, node); if (md) blocks.push(md); return }

    const isBlock = ['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'blockquote', 'pre', 'section', 'article'].includes(tag)
    const isHeading = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tag)

    if (isBlock) blocks.push('\n')
    if (isHeading) blocks.push('\n## ')
    for (const child of node.children ?? []) walk(child)
    if (isBlock) blocks.push('\n')
    if (tag === 'br') blocks.push('\n')
  }

  for (const child of $el[0]?.children ?? []) walk(child)

  return blocks.join('')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+\|/g, '\n|')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\u00a0/g, ' ')
    .trim()
}

// ── RSS feed fallback ──

const readFromFeed = async (articleUrl: string, feedUrl: string): Promise<{ title: string; text: string }> => {
  const res = await fetch(feedUrl, TLS(feedUrl) as any)
  if (!res.ok) throw new Error(`RSS fetch failed: ${res.status}`)
  const $ = cheerio.load(await res.text(), { xml: true })

  let title = '', text = ''
  $('item, entry').each((_, el) => {
    const link = $(el).find('link').attr('href') ?? $(el).find('link').text().trim()
    if (!link || !articleUrl.includes(new URL(link).pathname)) return
    title = $(el).find('title').text().trim()
    text = $(el).find('description, summary, content').first().text().trim()
      .replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
    return false
  })

  if (!title) throw new Error('Article not found in feed')
  return { title, text }
}

// ── SEC EDGAR resolver ──

const resolveEdgarDoc = async (indexUrl: string): Promise<{ docUrl: string; title: string } | null> => {
  try {
    const res = await fetch(indexUrl, {
      headers: { 'User-Agent': 'Subscope/1.0 (personal feed aggregator)' },
      ...TLS(indexUrl),
    } as any)
    if (!res.ok) return null
    const html = await res.text()
    const $ = cheerio.load(html)

    // Company name via CIK + EDGAR submissions API
    const cikMatch = indexUrl.match(/\/data\/(\d+)\//)
    let company = ''
    if (cikMatch) {
      try {
        const cik = cikMatch[1]!.padStart(10, '0')
        const apiUrl = `https://data.sec.gov/submissions/CIK${cik}.json`
        const api = await fetch(apiUrl, {
          headers: { 'User-Agent': 'Subscope/1.0 (personal feed aggregator)' },
          ...TLS(apiUrl),
        } as any)
        if (api.ok) company = ((await api.json()) as any).name ?? ''
      } catch {}
    }

    const formMatch = $.text().match(/Form\s+(8-K|10-K|10-Q|8-K\/A)/i)
    const formType = formMatch?.[1] ?? '8-K'
    const title = company ? `[${formType}] ${company}` : formType

    const ixMatch = html.match(/\/ix\?doc=(\/Archives\/[^"'&]+\.htm)/)
    if (ixMatch) return { docUrl: `https://www.sec.gov${ixMatch[1]}`, title }
    const archiveMatch = html.match(/href="(\/Archives\/[^"]+\.htm)"/)
    if (archiveMatch) return { docUrl: `https://www.sec.gov${archiveMatch[1]}`, title }
    return null
  } catch { return null }
}
