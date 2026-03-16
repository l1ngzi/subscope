import * as cheerio from 'cheerio'
import { join } from 'path'
import { item, sortDesc, UA } from '../../lib.ts'
import type { Source, FeedItem } from '../../types.ts'

const BASE = 'http://www.news.cn'

// Xinhua pages are JS-rendered, need Playwright
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

export const fetchXinhua = async (source: Source): Promise<FeedItem[]> => {
  const html = fetchPage(source.url)
  const $ = cheerio.load(html)
  const items: FeedItem[] = []
  const seen = new Set<string>()

  // Xinhua links: news.cn/YYYYMMDD/... or news.cn/world/YYYYMMDD/...
  $('a[href*="news.cn/"]').each((_, el) => {
    const $a = $(el)
    const href = $a.attr('href')
    if (!href) return

    const title = $a.attr('title') || $a.text().trim()
    if (!title || title.length < 4 || title.length > 200) return
    // Skip navigation/category links
    if (href.endsWith('/index.htm') || href.endsWith('/index.html')) return

    const url = href.startsWith('http') ? href : `${BASE}${href}`
    // Only article URLs (contain date-like pattern)
    if (!/\/\d{8}\/|\/2\d{3}\//.test(url)) return
    if (seen.has(url)) return
    seen.add(url)

    // Date from URL: /20260316/ or /2026/0316/
    const dateMatch = url.match(/\/(\d{4})(\d{2})(\d{2})\//)
      || url.match(/\/(\d{4})\/(\d{2})(\d{2})\//)
    const publishedAt = dateMatch
      ? new Date(`${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}T00:00:00+08:00`).toISOString()
      : undefined

    items.push(item(source, url, title, { publishedAt }))
  })

  return sortDesc(items)
}
