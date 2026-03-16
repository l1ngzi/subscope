import * as cheerio from 'cheerio'
import { join } from 'path'
import { item, sortDesc, UA } from '../../lib.ts'
import type { Source, FeedItem } from '../../types.ts'

const BASE = 'https://www.nfra.gov.cn'

// Angular SPA needs networkidle to render content
const fetchWithAngular = (url: string): string => {
  const projectRoot = join(import.meta.dir, '..', '..')
  const script = [
    `const{chromium}=require('playwright');`,
    `(async()=>{`,
    `const b=await chromium.launch({headless:true,channel:'chrome',`,
    `args:['--disable-blink-features=AutomationControlled','--ignore-certificate-errors']});`,
    `const ctx=await b.newContext({ignoreHTTPSErrors:true,userAgent:${JSON.stringify(UA)}});`,
    `const p=await ctx.newPage();`,
    `await p.goto(${JSON.stringify(url)},{waitUntil:'networkidle',timeout:20000});`,
    `process.stdout.write(await p.content());`,
    `await b.close();`,
    `})().catch(e=>{process.stderr.write(e.message);process.exit(1)});`,
  ].join('')
  const r = Bun.spawnSync(['node', '-e', script], {
    stdout: 'pipe', stderr: 'pipe', timeout: 30_000,
    cwd: projectRoot,
    env: { ...process.env, NODE_PATH: join(projectRoot, 'node_modules') },
  })
  if (r.exitCode !== 0) throw new Error(`Browser fetch failed: ${new TextDecoder().decode(r.stderr).trim()}`)
  return new TextDecoder().decode(r.stdout)
}

export const fetchNFRA = async (source: Source): Promise<FeedItem[]> => {
  const html = fetchWithAngular(source.url)

  const $ = cheerio.load(html)
  const items: FeedItem[] = []
  const seen = new Set<string>()

  // Extract itemId from source URL to filter to the right section
  const itemId = new URL(source.url).searchParams.get('itemId') ?? '915'

  // Main list: .panel-row with both a link and span.date
  $('.panel-row').each((_, el) => {
    const $row = $(el)
    const $date = $row.find('span.date')
    if (!$date.length) return // skip tab-section rows (no date)

    const $a = $row.find('a[href*="ItemDetail.html?docId="]').first()
    const title = ($a.attr('title') || $a.text()).trim()
    const href = $a.attr('href')
    if (!title || !href || title.length < 4) return

    const url = href.startsWith('http') ? href
      : href.startsWith('/') ? `${BASE}${href}`
      : `${BASE}/cn/view/pages/${href}`
    if (seen.has(url)) return
    seen.add(url)

    const raw = $date.text().trim()
    const dateMatch = raw.match(/(\d{4}-\d{2}-\d{2})/)
    const publishedAt = dateMatch
      ? new Date(`${dateMatch[1]}T00:00:00+08:00`).toISOString()
      : undefined

    items.push(item(source, url, title, { publishedAt }))
  })

  return sortDesc(items)
}
