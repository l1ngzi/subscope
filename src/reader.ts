import * as cheerio from 'cheerio'
import { UA, TLS } from './lib.ts'
import { fetchWithBrowser } from './browser.ts'

// Site-specific content selectors and extraction rules
interface SiteRule {
  test: (url: string) => boolean
  selector: string
  headers?: Record<string, string>
  title?: string
  cleanTitle?: (t: string) => string
  pick?: ($: cheerio.CheerioAPI) => cheerio.Cheerio<any>
  feedUrl?: string
}

const SITES: SiteRule[] = [
  // ── Economics & Finance ──
  {
    test: u => u.includes('bea.gov'),
    selector: '.field--name-body.field--item',
    title: 'title',
    cleanTitle: t => t.replace(/\s*\|.*$/, '').trim(),
    pick: $ => $('.field--name-body.field--item').first(),
  },
  {
    test: u => u.includes('pbc.gov.cn'),
    selector: '#zoom',
    title: '.zw_title, h1, title',
  },
  {
    test: u => u.includes('stats.gov.cn'),
    selector: '.txt-content',
    title: 'title',
    cleanTitle: t => t.replace(/\s*[-–—]\s*国家统计局.*$/, '').trim(),
  },
  {
    test: u => u.includes('federalreserve.gov'),
    selector: '#article .col-xs-12.col-sm-8.col-md-8',
    title: '#article h3.title, h3.title',
    pick: $ => {
      const divs = $('#article .col-xs-12.col-sm-8.col-md-8')
      return divs.length > 1 ? divs.eq(1) : divs
    },
  },
  {
    test: u => u.includes('sec.gov/Archives'),
    selector: 'body',
    title: 'title',
    pick: $ => {
      const $body = $('body').clone()
      $body.find('[style*="display:none"], [style*="display: none"], ix\\:hidden, .xbrl').remove()
      return $body
    },
  },
  {
    test: u => u.includes('bls.gov'),
    selector: '#bodytext, pre, .centerDiv',
    headers: {
      'Sec-Fetch-Dest': 'document', 'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none', 'Sec-Fetch-User': '?1',
    },
    title: 'h2, h1, title',
  },
  {
    test: u => u.includes('ecb.europa.eu'),
    selector: 'main .section',
    title: 'main .title h1, title',
  },
  {
    test: u => u.includes('home.treasury.gov'),
    selector: 'article, .node__content',
    title: 'title',
    cleanTitle: t => t.replace(/\s*\|\s*U\.S\. Department.*$/, '').trim(),
    pick: $ => {
      const $article = $('article .field--name-body .field__item')
      if ($article.length && $article.text().trim().length > 100) return $article
      const desc = $('meta[property="og:description"]').attr('content')
      if (desc) {
        const $div = $('<div>')
        desc.split(/\s{2,}/).forEach(p => $div.append(`<p>${p.trim()}</p>`))
        return $div
      }
      return $('body')
    },
  },
  {
    test: u => u.includes('imf.org'),
    selector: 'article .column-padding, article',
    title: 'h1, title',
    cleanTitle: t => t.replace(/\s*[-–]\s*IMF$/, '').trim(),
  },
  // ── AI companies ──
  {
    test: u => u.includes('anthropic.com'),
    selector: 'article',
    title: 'h1',
    cleanTitle: t => t.replace(/\s*[\|–—]\s*Anthropic$/, '').trim(),
    pick: $ => $('[class*="Body-module"][class*="__body"]').first(),
  },
  {
    test: u => /claude\.com\/blog\/.+/.test(u),
    selector: '.u-rich-text-blog',
    title: 'h1',
    pick: $ => {
      const $body = $('.u-rich-text-blog:not(.w-condition-invisible)').first().clone()
      $body.find('figure').remove()
      return $body
    },
  },
  {
    test: u => u.includes('support.claude.com') && u.includes('/articles/'),
    selector: '.article_body article',
    title: 'h1',
    pick: $ => {
      const $article = $('.article_body article').clone()
      $article.find('section.related_articles').remove()
      return $article
    },
  },
  {
    test: u => u.includes('api-docs.deepseek.com'),
    selector: '.theme-doc-markdown.markdown',
    title: 'h1',
    cleanTitle: t => t.replace(/\s*\|.*$/, '').trim(),
  },
  {
    test: u => u.includes('x.ai/news/'),
    selector: 'article, main',
    title: 'h1',
    cleanTitle: t => t.replace(/\s*\|\s*xAI$/, '').trim(),
    pick: $ => {
      const $prose = $('.prose.prose-invert').first().clone()
      if (!$prose.length) return $prose
      $prose.find('[class*="not-prose"]').remove()
      return $prose
    },
  },
  {
    test: u => u.includes('openai.com/index/') || u.includes('openai.com/research/'),
    selector: 'article',
    title: 'h1',
    cleanTitle: t => t.replace(/\s*\|\s*OpenAI$/, '').trim(),
    feedUrl: 'https://openai.com/news/rss.xml',
  },
  {
    test: u => u.includes('deepmind.google'),
    selector: 'main',
    title: 'h1',
    cleanTitle: t => t.replace(/\s*[—–-]\s*Google DeepMind$/, '').trim(),
    feedUrl: 'https://deepmind.google/blog/rss.xml',
  },
  // ── Other ──
  {
    test: u => u.includes('github.com') && /\/releases\/tag\//.test(u),
    selector: '.markdown-body',
    title: 'title',
    cleanTitle: t => t.replace(/\s*·\s*GitHub$/, '').trim(),
    pick: $ => $('[data-test-selector="body-content"]').first(),
  },
]

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
    const res = await fetch(url, { headers, ...TLS } as any)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    html = await res.text()
  } catch {
    if (site?.feedUrl) {
      const rss = await readFromFeed(url, site.feedUrl).catch(() => null)
      if (rss) return rss
    }
    html = fetchWithBrowser(url)
  }

  const $ = cheerio.load(html)

  // Title
  const titleSel = site?.title ?? 'h1, title'
  let title = ''
  for (const sel of titleSel.split(',')) {
    title = $(sel.trim()).first().text().trim()
    if (title) break
  }
  if (!title) title = $('title').text().trim()
  if (site?.cleanTitle) title = site.cleanTitle(title)

  // Body
  let $body: cheerio.Cheerio<any> | null = null
  if (site?.pick) $body = site.pick($)
  if (!$body || !$body.length) {
    const selector = site?.selector ?? 'article, main, .content, .post-body, body'
    for (const sel of selector.split(',')) {
      const $el = $(sel.trim())
      if ($el.length) { $body = $el.first(); break }
    }
  }
  if (!$body || !$body.length) $body = $('body')

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

// ── Text extraction ──

const extractText = ($el: cheerio.Cheerio<any>, $: cheerio.CheerioAPI): string => {
  const blocks: string[] = []

  const renderTable = (node: any) => {
    const trs = $(node).find('tr').toArray()
    const grid: string[][] = []
    const occupied = new Set<string>()

    for (let r = 0; r < trs.length; r++) {
      if (!grid[r]) grid[r] = []
      let col = 0
      $(trs[r]!).find('th, td').each((_, cell) => {
        while (occupied.has(`${r},${col}`)) col++
        const text = $(cell).text().replace(/\s+/g, ' ').trim()
        const colspan = parseInt($(cell).attr('colspan') || '1', 10)
        const rowspan = parseInt($(cell).attr('rowspan') || '1', 10)
        for (let dr = 0; dr < rowspan; dr++) {
          for (let dc = 0; dc < colspan; dc++) {
            const gr = r + dr, gc = col + dc
            if (!grid[gr]) grid[gr] = []
            grid[gr]![gc] = (dr === 0 && dc === 0) ? text : ''
            if (dr > 0 || dc > 0) occupied.add(`${gr},${gc}`)
          }
        }
        col += colspan
      })
    }

    const rows = grid.filter(r => r && r.some(c => c?.trim()))
    if (!rows.length) return
    const colCount = Math.max(...rows.map(r => r.length))
    for (const row of rows) { while (row.length < colCount) row.push(''); row.splice(colCount) }

    // Find data start (first row where most cells are numeric)
    const isNumRow = (r: string[]) => r.filter(c => /^-?[\d,.]+%?$/.test((c ?? '').replace(/[()p]/g, ''))).length > r.length / 3
    let dataStart = rows.findIndex(r => isNumRow(r))
    if (dataStart < 0) dataStart = rows.length > 2 ? 2 : 1

    // Flatten multi-row headers: "GroupName: SubColumn"
    const header: string[] = Array(colCount).fill('')
    if (dataStart <= 1) {
      for (let c = 0; c < colCount; c++) header[c] = (rows[0]![c] ?? '').trim()
    } else {
      const groups: string[] = Array(colCount).fill('')
      for (let r = 0; r < dataStart - 1; r++) {
        let lastGroup = ''
        for (let c = 0; c < colCount; c++) {
          const val = (rows[r]![c] ?? '').trim()
          if (val) lastGroup = val
          else if (lastGroup && !groups[c]) groups[c] = lastGroup
          if (val) groups[c] = val
        }
      }
      const lastHeaderRow = rows[dataStart - 1]!
      for (let c = 0; c < colCount; c++) {
        const sub = (lastHeaderRow[c] ?? '').trim()
        const group = groups[c]
        header[c] = sub && group && sub !== group ? `${group}: ${sub}` : sub || group || ''
      }
    }

    const finalRows = [header, ...rows.slice(dataStart)]
    const widths: number[] = Array(colCount).fill(0)
    for (const row of finalRows)
      for (let i = 0; i < row.length; i++)
        widths[i] = Math.max(widths[i]!, (row[i] ?? '').length)

    const pad = (s: string, w: number) => s + ' '.repeat(Math.max(0, w - s.length))
    const fmtRow = (row: string[]) => '| ' + row.map((c, i) => pad(c ?? '', widths[i]!)).join(' | ') + ' |'

    blocks.push('\n', fmtRow(finalRows[0]!), '\n')
    blocks.push('|' + widths.map(w => '-'.repeat(w + 2)).join('|') + '|', '\n')
    for (let i = 1; i < finalRows.length; i++) blocks.push(fmtRow(finalRows[i]!), '\n')
    blocks.push('\n')
  }

  const walk = (node: any) => {
    if (node.type === 'text') {
      const t = node.data?.replace(/\s+/g, ' ') ?? ''
      if (t.trim()) blocks.push(t)
      return
    }
    if (node.type !== 'tag') return
    const tag = node.name?.toLowerCase()
    if (['script', 'style', 'nav', 'footer', 'img', 'svg', 'iframe'].includes(tag)) return
    if (tag === 'table') { renderTable(node); return }

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
  const res = await fetch(feedUrl, TLS as any)
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
      ...TLS,
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
        const api = await fetch(`https://data.sec.gov/submissions/CIK${cik}.json`, {
          headers: { 'User-Agent': 'Subscope/1.0 (personal feed aggregator)' },
          ...TLS,
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
