import * as cheerio from 'cheerio'
import { join } from 'path'
import { item, sortDesc, UA } from '../../lib.ts'
import type { Source, FeedItem } from '../../types.ts'

const BASE = 'https://news.cctv.com'

// CCTV news pages are JS-rendered, need Playwright
const fetchPage = (url: string): string => {
  const projectRoot = join(import.meta.dir, '..', '..')
  const script = [
    `const{chromium}=require('playwright');`,
    `(async()=>{`,
    `const b=await chromium.launch({headless:true,channel:'chrome',`,
    `args:['--disable-blink-features=AutomationControlled','--ignore-certificate-errors']});`,
    `const ctx=await b.newContext({ignoreHTTPSErrors:true,userAgent:${JSON.stringify(UA)}});`,
    `const p=await ctx.newPage();`,
    `await p.addInitScript(()=>{Object.defineProperty(navigator,'webdriver',{get:()=>false})});`,
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

export const fetchCCTV = async (source: Source): Promise<FeedItem[]> => {
  const html = fetchPage(source.url)
  const $ = cheerio.load(html)
  const items: FeedItem[] = []
  const seen = new Set<string>()

  // News items: links to news.cctv.com/YYYY/MM/DD/ARTI*.shtml
  $('a[href*="news.cctv.com/20"]').each((_, el) => {
    const $a = $(el)
    const href = $a.attr('href')
    if (!href || !href.includes('.shtml')) return

    // Title: either in h3, or the link text, or nearby heading
    const title = $a.closest('h3').text().trim()
      || $a.find('h3').text().trim()
      || $a.text().trim()
    if (!title || title.length < 4 || title.length > 200) return

    const url = href.startsWith('http') ? href : `${BASE}${href}`
    if (seen.has(url)) return
    seen.add(url)

    // Date from URL: /2026/03/16/ARTI...
    const dateMatch = url.match(/\/(\d{4})\/(\d{2})\/(\d{2})\//)
    const publishedAt = dateMatch
      ? new Date(`${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}T00:00:00+08:00`).toISOString()
      : undefined

    // Summary from sibling <p>
    const summary = $a.closest('div').find('p').first().text().trim().slice(0, 200) || undefined

    items.push(item(source, url, title, { summary, publishedAt }))
  })

  return sortDesc(items)
}
