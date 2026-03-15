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
    test: u => u.includes('sec.gov/Archives'),
    selector: 'body',
    title: 'title',
    pick: ($: cheerio.CheerioAPI) => {
      // SEC filings: remove XBRL hidden/metadata elements, keep visible content
      const $body = $('body').clone()
      $body.find('[style*="display:none"], [style*="display: none"], ix\\:hidden, .xbrl').remove()
      return $body
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
  {
    test: u => u.includes('ecb.europa.eu'),
    selector: 'main .section',
    title: 'main .title h1, title',
  },
  {
    test: u => u.includes('home.treasury.gov'),
    selector: 'article, .node__content',
    title: 'title',
    cleanTitle: (t: string) => t.replace(/\s*\|\s*U\.S\. Department.*$/, '').trim(),
    // Treasury renders content via JS; fallback: extract from og:description meta tag
    pick: ($: cheerio.CheerioAPI) => {
      const $article = $('article .field--name-body .field__item')
      if ($article.length && $article.text().trim().length > 100) return $article
      // JS-rendered page: build content from og:description
      const desc = $('meta[property="og:description"]').attr('content')
      if (desc) {
        const $div = $('<div>')
        // Split into paragraphs on double-space or sentence boundaries
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
    cleanTitle: (t: string) => t.replace(/\s*[-–]\s*IMF$/, '').trim(),
  },
  // ── AI companies ──
  {
    test: u => u.includes('anthropic.com'),
    selector: 'article',
    title: 'h1',
    cleanTitle: (t: string) => t.replace(/\s*[\|–—]\s*Anthropic$/, '').trim(),
    pick: ($: cheerio.CheerioAPI) => {
      // CSS modules: Body-module-scss-module__HASH__body
      return $('[class*="Body-module"][class*="__body"]').first()
    },
  },
  {
    test: u => /claude\.com\/blog\/.+/.test(u),
    selector: '.u-rich-text-blog',
    title: 'h1',
    pick: ($: cheerio.CheerioAPI) => {
      const $body = $('.u-rich-text-blog:not(.w-condition-invisible)').first().clone()
      $body.find('figure').remove()
      return $body
    },
  },
  {
    test: u => u.includes('support.claude.com') && u.includes('/articles/'),
    selector: '.article_body article',
    title: 'h1',
    pick: ($: cheerio.CheerioAPI) => {
      const $article = $('.article_body article').clone()
      $article.find('section.related_articles').remove()
      return $article
    },
  },
  {
    test: u => u.includes('api-docs.deepseek.com'),
    selector: '.theme-doc-markdown.markdown',
    title: 'h1',
    cleanTitle: (t: string) => t.replace(/\s*\|.*$/, '').trim(),
  },
  {
    test: u => u.includes('x.ai/news/'),
    selector: 'article, main',
    title: 'h1',
    cleanTitle: (t: string) => t.replace(/\s*\|\s*xAI$/, '').trim(),
    pick: ($: cheerio.CheerioAPI) => {
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
    cleanTitle: (t: string) => t.replace(/\s*\|\s*OpenAI$/, '').trim(),
  },
  {
    test: u => u.includes('deepmind.google'),
    selector: 'main',
    title: 'h1',
    cleanTitle: (t: string) => t.replace(/\s*[—–-]\s*Google DeepMind$/, '').trim(),
  },
  // ── Other ──
  {
    test: u => u.includes('github.com') && /\/releases\/tag\//.test(u),
    selector: '.markdown-body',
    title: 'h1',
    pick: ($: cheerio.CheerioAPI) => {
      return $('[data-test-selector="body-content"]').first()
    },
  },
]

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

export const readArticle = async (url: string): Promise<{ title: string; text: string }> => {
  // X/Twitter: use oembed API for tweets (no auth needed)
  if ((url.includes('x.com/') || url.includes('twitter.com/')) && url.includes('/status/')) {
    return readTweet(url)
  }

  // SEC EDGAR: filing index pages → auto-follow to the actual document
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
    const res = await fetch(url, { headers, tls: { rejectUnauthorized: false } } as any)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    html = await res.text()
  } catch {
    html = await fetchWithBrowser(url)
  }
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

  const cellText = (el: any): string =>
    $(el).text().replace(/\s+/g, ' ').trim()

  const renderTable = (node: any) => {
    // Build a proper grid handling colspan + rowspan
    const trs = $(node).find('tr').toArray()
    const grid: string[][] = []
    const occupied: Set<string> = new Set() // "row,col" keys for rowspan-occupied cells

    for (let r = 0; r < trs.length; r++) {
      if (!grid[r]) grid[r] = []
      let col = 0
      $(trs[r]!).find('th, td').each((_, cell) => {
        // Skip cells occupied by rowspan from above
        while (occupied.has(`${r},${col}`)) col++
        const text = cellText(cell)
        const colspan = parseInt($(cell).attr('colspan') || '1', 10)
        const rowspan = parseInt($(cell).attr('rowspan') || '1', 10)
        // Fill grid for this cell's span
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

    // Filter empty rows, normalize column count
    const rows = grid.filter(r => r && r.some(c => c?.trim()))
    if (!rows.length) return
    const colCount = Math.max(...rows.map(r => r.length))
    for (const row of rows) { while (row.length < colCount) row.push(''); row.splice(colCount) }

    // Find where data starts (first row where most cells are numeric)
    const isNumRow = (r: string[]) => r.filter(c => /^-?[\d,.]+%?$/.test((c ?? '').replace(/[()p]/g, ''))).length > r.length / 3
    let dataStart = rows.findIndex(r => isNumRow(r))
    if (dataStart < 0) dataStart = rows.length > 2 ? 2 : 1

    // Flatten multi-row headers into one row: "GroupName: SubColumn" format
    // Track last non-empty group label per column (from colspan spans)
    const header: string[] = Array(colCount).fill('')
    if (dataStart <= 1) {
      // Single header row — use as-is
      for (let c = 0; c < colCount; c++) header[c] = (rows[0]![c] ?? '').trim()
    } else {
      // Multi-row: propagate group labels across their colspan span, then combine
      // Row 0 typically has group headers with empty cells for spanned columns
      // Row 1+ has specific column names
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
      // Last header row has the specific column names
      const lastHeaderRow = rows[dataStart - 1]!
      for (let c = 0; c < colCount; c++) {
        const sub = (lastHeaderRow[c] ?? '').trim()
        const group = groups[c]
        if (sub && group && sub !== group) {
          header[c] = `${group}: ${sub}`
        } else {
          header[c] = sub || group
        }
      }
    }

    const dataRows = rows.slice(dataStart)
    const finalRows = [header, ...dataRows]

    const widths: number[] = Array(colCount).fill(0)
    for (const row of finalRows) {
      for (let i = 0; i < row.length; i++) {
        widths[i] = Math.max(widths[i]!, (row[i] ?? '').length)
      }
    }

    const pad = (s: string, w: number) => s + ' '.repeat(Math.max(0, w - s.length))

    const fmtRow = (row: string[]) =>
      '| ' + row.map((c, i) => pad(c ?? '', widths[i]!)).join(' | ') + ' |'

    blocks.push('\n')
    blocks.push(fmtRow(finalRows[0]!))
    blocks.push('\n')
    blocks.push('|' + widths.map(w => '-'.repeat(w + 2)).join('|') + '|')
    blocks.push('\n')
    for (let i = 1; i < finalRows.length; i++) {
      blocks.push(fmtRow(finalRows[i]!))
      blocks.push('\n')
    }
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

    // Tables: render as Markdown table
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

  return blocks
    .join('')
    .replace(/[ \t]+/g, ' ')           // collapse horizontal whitespace (but not inside table rows)
    .replace(/\n[ \t]+\|/g, '\n|')     // trim before table pipes
    .replace(/\n[ \t]+/g, '\n')         // trim line starts
    .replace(/[ \t]+\n/g, '\n')         // trim line ends
    .replace(/\n{3,}/g, '\n\n')         // max 2 consecutive newlines
    .replace(/\u00a0/g, ' ')           // replace nbsp
    .trim()
}

// X/Twitter: fetch tweet text via oembed API
const readTweet = async (url: string): Promise<{ title: string; text: string }> => {
  const oembedUrl = `https://publish.twitter.com/oembed?url=${encodeURIComponent(url)}&omit_script=true`
  const res = await fetch(oembedUrl)
  if (!res.ok) throw new Error(`Tweet not found (${res.status})`)
  const data = await res.json() as { author_name: string; html: string }
  const $ = cheerio.load(data.html)
  const text = $('blockquote p').map((_, el) => $(el).text()).get().join('\n\n')
  return { title: data.author_name || 'Tweet', text }
}

// SEC EDGAR: resolve filing index page → main document URL + title
const resolveEdgarDoc = async (indexUrl: string): Promise<{ docUrl: string; title: string } | null> => {
  try {
    const res = await fetch(indexUrl, {
      headers: { 'User-Agent': 'Subscope/1.0 (personal feed aggregator)' },
      tls: { rejectUnauthorized: false },
    } as any)
    if (!res.ok) return null
    const html = await res.text()
    const $ = cheerio.load(html)

    // Extract company name via CIK from URL + EDGAR submissions API
    const cikMatch = indexUrl.match(/\/data\/(\d+)\//)
    let company = ''
    let formType = ''
    if (cikMatch) {
      try {
        const cik = cikMatch[1]!.padStart(10, '0')
        const api = await fetch(`https://data.sec.gov/submissions/CIK${cik}.json`, {
          headers: { 'User-Agent': 'Subscope/1.0 (personal feed aggregator)' },
          tls: { rejectUnauthorized: false },
        } as any)
        if (api.ok) {
          const data = await api.json() as any
          company = data.name ?? ''
        }
      } catch {}
    }
    // Get form type from page text
    const pageText = $.text()
    const formMatch = pageText.match(/Form\s+(8-K|10-K|10-Q|8-K\/A)/i)
    formType = formMatch?.[1] ?? '8-K'
    const title = company ? `[${formType}] ${company}` : formType

    // The iXBRL viewer link contains the main document path: /ix?doc=/Archives/...
    const ixMatch = html.match(/\/ix\?doc=(\/Archives\/[^"'&]+\.htm)/)
    if (ixMatch) return { docUrl: `https://www.sec.gov${ixMatch[1]}`, title }
    // Fallback: first .htm file in /Archives/ that isn't an exhibit
    const archiveMatch = html.match(/href="(\/Archives\/[^"]+\.htm)"/)
    if (archiveMatch) return { docUrl: `https://www.sec.gov${archiveMatch[1]}`, title }
    return null
  } catch { return null }
}

// Playwright fallback for anti-bot sites (BLS, etc.)
// Spawns Edge with anti-detection flags via node + playwright
const fetchWithBrowser = (url: string): Promise<string> => {
  const script = [
    `const{chromium}=require('playwright');`,
    `(async()=>{`,
    `const b=await chromium.launch({headless:true,channel:'chrome',`,
    `args:['--disable-blink-features=AutomationControlled','--ignore-certificate-errors']});`,
    `const ctx=await b.newContext({ignoreHTTPSErrors:true,userAgent:`,
    `'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'});`,
    `const p=await ctx.newPage();`,
    `await p.addInitScript(()=>{Object.defineProperty(navigator,'webdriver',{get:()=>false})});`,
    `await p.goto(${JSON.stringify(url)},{waitUntil:'domcontentloaded',timeout:20000});`,
    `process.stdout.write(await p.content());`,
    `await b.close();`,
    `})().catch(e=>{process.stderr.write(e.message);process.exit(1)});`,
  ].join('')
  const { join } = require('path') as typeof import('path')
  const projectRoot = join(import.meta.dir, '..')
  const r = Bun.spawnSync(['node', '-e', script], {
    stdout: 'pipe', stderr: 'pipe', timeout: 30_000,
    cwd: projectRoot,
    env: { ...process.env, NODE_PATH: join(projectRoot, 'node_modules') },
  })
  if (r.exitCode !== 0) {
    const err = new TextDecoder().decode(r.stderr).trim()
    throw new Error(`Browser fetch failed: ${err || 'unknown error'}`)
  }
  return Promise.resolve(new TextDecoder().decode(r.stdout))
}
