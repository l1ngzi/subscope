import * as cheerio from 'cheerio'
import { join } from 'path'
import { item, sortDesc, UA } from '../../lib.ts'
import type { Source, FeedItem } from '../../types.ts'

const BASE = 'https://www.opec.org'

// OPEC blocks fetch (403) — needs Playwright
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

export const fetchOPEC = async (source: Source): Promise<FeedItem[]> => {
  const html = fetchPage(source.url)
  const $ = cheerio.load(html)
  const items: FeedItem[] = []
  const seen = new Set<string>()

  $('a[href*="/pr-detail/"]').each((_, el) => {
    const href = $(el).attr('href')
    if (!href) return

    const url = href.startsWith('http') ? href : `${BASE}${href}`
    if (seen.has(url)) return
    seen.add(url)

    // Title: walk up to find heading
    let $block = $(el).parent()
    let title = ''
    for (let i = 0; i < 8 && !title; i++) {
      title = $block.find('h2, h3, h4, h5').first().text().trim()
      $block = $block.parent()
    }
    if (!title || title.length < 10) return

    // Date from URL: /594-4-march-2026.html
    const dateMatch = href.match(/(\d{1,2})-(\w+)-(\d{4})\.html/)
    let publishedAt: string | undefined
    if (dateMatch) {
      try { publishedAt = new Date(`${dateMatch[2]} ${dateMatch[1]}, ${dateMatch[3]}`).toISOString() } catch {}
    }

    items.push(item(source, url, title, { publishedAt }))
  })

  return sortDesc(items)
}
