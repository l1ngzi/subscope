import * as cheerio from 'cheerio'
import { createHash } from 'crypto'
import type { Source, FeedItem } from '../../types.ts'

const hash = (...parts: string[]) =>
  createHash('sha256').update(parts.join(':')).digest('hex').slice(0, 12)

const BASE = 'https://www.imf.org'

// Playwright browser fetch — IMF blocks non-browser TLS fingerprints
const fetchWithBrowser = (url: string): string => {
  const { join } = require('path') as typeof import('path')
  const projectRoot = join(import.meta.dir, '..', '..')
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
  const r = Bun.spawnSync(['node', '-e', script], {
    stdout: 'pipe', stderr: 'pipe', timeout: 30_000,
    cwd: projectRoot,
    env: { ...process.env, NODE_PATH: join(projectRoot, 'node_modules') },
  })
  if (r.exitCode !== 0) throw new Error(`Browser fetch failed: ${new TextDecoder().decode(r.stderr).trim()}`)
  return new TextDecoder().decode(r.stdout)
}

export const fetchIMF = async (source: Source): Promise<FeedItem[]> => {
  let html: string
  try {
    const res = await fetch(source.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Sec-Fetch-Dest': 'document', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Site': 'none', 'Sec-Fetch-User': '?1',
      },
      tls: { rejectUnauthorized: false },
    } as any)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    html = await res.text()
    // Check if we got actual content
    if (!html.includes('/news/articles/')) throw new Error('blocked')
  } catch {
    html = fetchWithBrowser(source.url)
  }
  const $ = cheerio.load(html)
  const items: FeedItem[] = []
  const seen = new Set<string>()

  // Latest News sidebar list
  $('div.link-list--news li a[href*="/news/articles/"]').each((_, el) => {
    const $a = $(el)
    const href = $a.attr('href')
    if (!href) return

    const dateText = $a.find('span').first().text().trim()
    const title = $a.text().replace(dateText, '').trim()
    if (!title) return

    const url = href.startsWith('http') ? href : `${BASE}${href}`
    if (seen.has(url)) return
    seen.add(url)

    const publishedAt = dateText ? new Date(dateText).toISOString() : new Date().toISOString()

    items.push({
      id: hash(source.id, url),
      sourceId: source.id,
      sourceType: 'website',
      sourceName: source.name,
      title,
      url,
      publishedAt,
    })
  })

  return items.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
}
