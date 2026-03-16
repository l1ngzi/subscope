import * as cheerio from 'cheerio'
import { join } from 'path'
import { item, sortDesc, UA } from '../../lib.ts'
import type { Source, FeedItem } from '../../types.ts'

const BASE = 'https://www.irena.org'

// IRENA blocks fetch (403) — needs Playwright
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
    `await p.goto(${JSON.stringify(url)},{waitUntil:'domcontentloaded',timeout:15000});`,
    `await new Promise(r=>setTimeout(r,3000));`,
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

export const fetchIRENA = async (source: Source): Promise<FeedItem[]> => {
  const html = fetchPage(source.url)
  const $ = cheerio.load(html)
  const items: FeedItem[] = []
  const seen = new Set<string>()

  $('a[href*="/News/"]').each((_, el) => {
    const $a = $(el)
    const href = $a.attr('href')
    if (!href || href === '/News' || href.endsWith('/News/')) return

    const title = $a.text().trim() || $a.attr('title')?.trim()
    if (!title || title.length < 10 || title.length > 300) return
    if (['News', 'Press Releases', 'Articles', 'Events'].includes(title)) return

    const url = href.startsWith('http') ? href : `${BASE}${href}`
    if (seen.has(url)) return
    seen.add(url)

    const dateMatch = url.match(/\/(\d{4})\/(\w{3})\//)
    let publishedAt: string | undefined
    if (dateMatch) {
      try { publishedAt = new Date(`${dateMatch[2]} 1, ${dateMatch[1]}`).toISOString() } catch {}
    }

    items.push(item(source, url, title, { publishedAt }))
  })

  return sortDesc(items)
}
