import * as cheerio from 'cheerio'

// Site-specific content selectors and headers
interface SiteRule {
  test: (url: string) => boolean
  selector: string
  headers?: Record<string, string>
  title?: string
  cleanTitle?: (t: string) => string
  pick?: ($: cheerio.CheerioAPI) => cheerio.Cheerio<any>
}

const SITES: SiteRule[] = [
  {
    test: u => u.includes('bea.gov'),
    selector: '.field--name-body.field--item',
    title: 'title',
    cleanTitle: (t: string) => t.replace(/\s*\|.*$/, '').trim(),
    pick: ($: cheerio.CheerioAPI) => {
      const items = $('.field--name-body.field--item')
      return items.first()
    },
  },
  {
    test: u => u.includes('pbc.gov.cn'),
    selector: '#zoom',
    title: '.zw_title, h1, title',
  },
  {
    test: u => u.includes('stats.gov.cn'),
    selector: '.txt-content',
    // NBS renders title via JS; extract from <title> tag and strip suffix
    title: 'title',
    cleanTitle: (t: string) => t.replace(/\s*[-–—]\s*国家统计局.*$/, '').trim(),
  },
  {
    test: u => u.includes('federalreserve.gov'),
    selector: '#article .col-xs-12.col-sm-8.col-md-8',
    title: '#article h3.title, h3.title',
    // Custom: second matching div is the body (first is heading)
    pick: ($: cheerio.CheerioAPI) => {
      const divs = $('#article .col-xs-12.col-sm-8.col-md-8')
      return divs.length > 1 ? divs.eq(1) : divs
    },
  },
  {
    test: u => u.includes('bls.gov'),
    selector: '#bodytext, pre, .centerDiv',
    headers: {
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
    },
    title: 'h2, h1, title',
  },
]

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

export const readArticle = async (url: string): Promise<{ title: string; text: string }> => {
  const site = SITES.find(s => s.test(url))
  const headers: Record<string, string> = {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8',
    ...site?.headers,
  }

  const res = await fetch(url, { headers, tls: { rejectUnauthorized: false } } as any)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const html = await res.text()
  const $ = cheerio.load(html)

  // Extract title
  const titleSel = site?.title ?? 'h1, title'
  let title = ''
  for (const sel of titleSel.split(',')) {
    title = $(sel.trim()).first().text().trim()
    if (title) break
  }
  if (!title) title = $('title').text().trim()
  if (site?.cleanTitle) title = site.cleanTitle(title)

  // Extract body — use site-specific pick() or fall back to selector
  let $body: cheerio.Cheerio<any> | null = null
  if (site?.pick) {
    $body = site.pick($)
  }
  if (!$body || !$body.length) {
    const selector = site?.selector ?? 'article, main, .content, .post-body, body'
    for (const sel of selector.split(',')) {
      const $el = $(sel.trim())
      if ($el.length) { $body = $el.first(); break }
    }
  }
  if (!$body || !$body.length) $body = $('body')

  // Clean: remove nav, scripts, styles, images, footers, noscript
  $body.find('script, style, noscript, nav, footer, .nav, .footer, .sidebar, .breadcrumb, img, svg, iframe, .ad, .share, .social').remove()

  // Convert block elements to newlines, preserve structure
  const text = extractText($body, $)

  return { title, text }
}

// Convert HTML to clean readable text with paragraph structure
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
    // Skip hidden or irrelevant elements
    if (['script', 'style', 'nav', 'footer', 'img', 'svg', 'iframe'].includes(tag)) return

    const isBlock = ['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'tr', 'blockquote', 'pre', 'section', 'article'].includes(tag)
    const isHeading = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tag)

    if (isBlock) blocks.push('\n')
    if (isHeading) blocks.push('\n## ')

    // Table cells: add separator
    if (tag === 'td' || tag === 'th') blocks.push(' | ')

    for (const child of node.children ?? []) walk(child)

    if (isBlock) blocks.push('\n')
    if (tag === 'br') blocks.push('\n')
    if (tag === 'tr') blocks.push('\n')
  }

  for (const child of $el[0]?.children ?? []) walk(child)

  return blocks
    .join('')
    .replace(/[ \t]+/g, ' ')           // collapse horizontal whitespace
    .replace(/\n[ \t]+/g, '\n')         // trim line starts
    .replace(/[ \t]+\n/g, '\n')         // trim line ends
    .replace(/\n{3,}/g, '\n\n')         // max 2 consecutive newlines
    .replace(/^\|/gm, '')              // strip leading table pipes
    .replace(/\| *$/gm, '')            // strip trailing table pipes
    .replace(/\u00a0/g, ' ')           // replace nbsp
    .trim()
}
