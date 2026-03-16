import * as cheerio from 'cheerio'
import { item, sortDesc } from '../../lib.ts'
import type { Source, FeedItem } from '../../types.ts'

const BASE = 'https://www.opec.org'

// OPEC uses Cloudflare with Client Hints challenge.
// Bun's BoringSSL TLS fingerprint gets blocked; curl's OpenSSL passes.
const fetchWithCurl = (url: string): string => {
  const r = Bun.spawnSync(['curl', '-sL', '--max-time', '15', url,
    '-A', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    '-H', 'Sec-CH-UA: "Google Chrome";v="131", "Chromium";v="131"',
    '-H', 'Sec-CH-UA-Mobile: ?0',
    '-H', 'Sec-CH-UA-Platform: "Windows"',
    '-H', 'Sec-Fetch-Dest: document',
    '-H', 'Sec-Fetch-Mode: navigate',
    '-H', 'Sec-Fetch-Site: none',
  ], { stdout: 'pipe', stderr: 'pipe', timeout: 20_000 })
  if (r.exitCode !== 0) throw new Error(`curl failed: ${new TextDecoder().decode(r.stderr).trim()}`)
  return new TextDecoder().decode(r.stdout)
}

export const fetchOPEC = async (source: Source): Promise<FeedItem[]> => {
  const html = fetchWithCurl(source.url)
  if (html.length < 1000) throw new Error(`OPEC: blocked (${html.length}b)`)
  const $ = cheerio.load(html)
  const items: FeedItem[] = []
  const seen = new Set<string>()

  $('.pritem').each((_, el) => {
    const $block = $(el)
    const title = $block.find('h1, h2, h3').first().text().trim()
    const href = $block.find('a[href*="pr-detail"]').attr('href')
    if (!title || !href) return

    const url = href.startsWith('http') ? href
      : href.startsWith('./') ? `${BASE}/${href.slice(2)}`
      : `${BASE}${href}`
    if (seen.has(url)) return
    seen.add(url)

    const dateMatch = href.match(/(\d{1,2})-(\w+)-(\d{4})\.html/)
    let publishedAt: string | undefined
    if (dateMatch) {
      try { publishedAt = new Date(`${dateMatch[2]} ${dateMatch[1]}, ${dateMatch[3]}`).toISOString() } catch {}
    }

    const summary = $block.find('p.text-justify, p:not(.text-opecgray):not(:empty)').first().text().trim().slice(0, 200) || undefined

    items.push(item(source, url, title, { summary, publishedAt }))
  })

  return sortDesc(items)
}
