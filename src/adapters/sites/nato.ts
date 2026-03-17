import { item, sortDesc, UA } from '../../lib.ts'
import type { Source, FeedItem } from '../../types.ts'

const BASE = 'https://www.nato.int'
const API = `${BASE}/content/nato/en/news-and-events/articles/news/jcr:content/root/container/general_search.search.json`

export const fetchNATO = async (source: Source): Promise<FeedItem[]> => {
  // First request: get total pages (API returns oldest-first)
  const firstUrl = `${API}?query=&searchType=wcm&sortBy=date&pageSize=25&page=1`
  const firstRes = await fetch(firstUrl, { headers: { 'User-Agent': UA } })
  if (!firstRes.ok) throw new Error(`NATO: ${firstRes.status}`)
  const firstJson = (await firstRes.json()) as any
  const totalPages = firstJson.numberOfPages ?? 1

  // Second request: fetch last page (newest items)
  const lastUrl = `${API}?query=&searchType=wcm&sortBy=date&pageSize=25&page=${totalPages}`
  const lastRes = await fetch(lastUrl, { headers: { 'User-Agent': UA } })
  if (!lastRes.ok) throw new Error(`NATO last page: ${lastRes.status}`)
  const json = (await lastRes.json()) as any

  const results: any[] = json.pages ?? []
  const items: FeedItem[] = []

  for (const r of results) {
    const title = r.title?.trim()
    const link = r.link?.trim()
    if (!title || !link) continue

    const raw = link.startsWith('http') ? link : `${BASE}${link}`
    const url = raw.replace(/\?selectedLocale=null$/, '')
    const summary = r.description?.replace(/<[^>]*>/g, '').trim().slice(0, 200) || undefined

    // Parse date: "DD Month YYYY" format
    let publishedAt: string | undefined
    if (r.pageDate) {
      const parsed = new Date(r.pageDate)
      if (!isNaN(parsed.getTime())) publishedAt = parsed.toISOString()
    }

    items.push(item(source, url, title, { summary, publishedAt }))
  }

  return sortDesc(items)
}
