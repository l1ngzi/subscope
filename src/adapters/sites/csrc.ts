import * as cheerio from 'cheerio'
import { join } from 'path'
import { item, sortDesc, UA } from '../../lib.ts'
import type { Source, FeedItem } from '../../types.ts'

const BASE = 'http://www.csrc.gov.cn'

// CSRC uses JS to load fresh content; static HTML is stale.
// Playwright with networkidle needed to get current data.
const fetchWithBrowser = (url: string): string => {
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

export const fetchCSRC = async (source: Source): Promise<FeedItem[]> => {
  const html = fetchWithBrowser(source.url)
  const $ = cheerio.load(html)
  const items: FeedItem[] = []

  // Structure: ul#list li > a + span.date
  $('#list li, .list li').each((_, el) => {
    const $a = $(el).find('a')
    const title = $a.text().trim()
    const href = $a.attr('href')
    if (!title || !href) return

    const url = href.startsWith('http') ? href : `${BASE}${href}`
    const dateText = $(el).find('.date, span').last().text().trim()
    const dateMatch = dateText.match(/(\d{4}-\d{2}-\d{2})/)

    items.push(item(source, url, title, {
      publishedAt: dateMatch
        ? new Date(`${dateMatch[1]}T00:00:00+08:00`).toISOString()
        : undefined,
    }))
  })

  return sortDesc(items)
}
