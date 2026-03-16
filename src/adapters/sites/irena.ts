import * as cheerio from 'cheerio'
import { item, sortDesc } from '../../lib.ts'
import type { Source, FeedItem } from '../../types.ts'

const BASE = 'https://www.irena.org'

// IRENA's Azure WAF blocks all pages (403) but sitemap.xml is open.
// Extract press release URLs + titles from sitemap, dates from URL path.
export const fetchIRENA = async (source: Source): Promise<FeedItem[]> => {
  // Azure WAF blocks Chrome UA but allows simple UA — don't impersonate, just be honest
  const r = Bun.spawnSync(['curl', '-sL', '--max-time', '15', `${BASE}/sitemap.xml`, '-A', 'Mozilla/5.0'],
    { stdout: 'pipe', stderr: 'pipe', timeout: 20_000 })
  if (r.exitCode !== 0) throw new Error('IRENA sitemap fetch failed')
  const $ = cheerio.load(new TextDecoder().decode(r.stdout), { xml: true })
  const items: FeedItem[] = []
  const seen = new Set<string>()

  $('loc').each((_, el) => {
    const rawUrl = $(el).text().trim()
    if (!rawUrl.includes('/News/pressreleases/')) return
    // Current year only
    const year = new Date().getFullYear()
    if (!rawUrl.includes(`/${year}/`)) return
    // Skip translated versions (end with -ZH, -RU, -FR, -ES, -AR, -PT, etc.)
    if (/-(?:ZH|RU|FR|ES|AR|PT|JP|IT|DE|KO)$/.test(rawUrl)) return

    const url = rawUrl.replace('http://', 'https://')
    if (seen.has(url)) return
    seen.add(url)

    // Title from URL slug: "Renewables-Jobs-See-First-Slowdown" → "Renewables Jobs See First Slowdown"
    const slug = url.split('/').pop()!
    const title = slug.replace(/-/g, ' ').replace(/\s+/g, ' ').trim()
    if (!title || title.length < 10) return

    // Date from URL path: /2026/Jan/
    const dateMatch = url.match(/\/(\d{4})\/(\w{3})\//)
    let publishedAt: string | undefined
    if (dateMatch) {
      try { publishedAt = new Date(`${dateMatch[2]} 15, ${dateMatch[1]}`).toISOString() } catch {}
    }

    items.push(item(source, url, title, { publishedAt }))
  })

  return sortDesc(items)
}
