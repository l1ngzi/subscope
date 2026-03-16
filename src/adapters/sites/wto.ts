import { item, sortDesc, UA } from '../../lib.ts'
import type { Source, FeedItem } from '../../types.ts'

const BASE = 'https://www.wto.org'

export const fetchWTO = async (source: Source): Promise<FeedItem[]> => {
  // WTO stores news in a JS file: news_item[id] = { ni_head, ni_intro, ni_date, ni_links }
  const year = new Date().getFullYear()
  const jsUrl = `${BASE}/library/news/news_${year}_e.js`
  const res = await fetch(jsUrl, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`WTO: ${res.status}`)

  const js = await res.text()
  const items: FeedItem[] = []

  // Parse each news_item block
  const blocks = js.split(/news_item\[\d+\]\s*=\s*\{/)
  for (const block of blocks) {
    const head = block.match(/ni_head:"([^"]+)"/)
    const intro = block.match(/ni_intro:"([^"]*)"/)
    const date = block.match(/ni_date:"(\d{4})\.(\d{2})\.(\d{2})/)
    const link = block.match(/nl_url:"([^"]+)"/)
    if (!head || !link) continue

    const url = `${BASE}${link[1]}`
    const title = head[1]!.replace(/&[a-z]+;/g, ' ').trim()
    const summary = intro?.[1]?.replace(/&[a-z]+;/g, ' ').replace(/<[^>]*>/g, '').trim().slice(0, 200)

    const publishedAt = date
      ? new Date(`${date[1]}-${date[2]}-${date[3]}T00:00:00Z`).toISOString()
      : undefined

    items.push(item(source, url, title, { summary, publishedAt }))
  }

  return sortDesc(items)
}
