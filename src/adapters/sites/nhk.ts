import { item, sortDesc } from '../../lib.ts'
import type { Source, FeedItem } from '../../types.ts'

const BASE = 'https://www3.nhk.or.jp'

interface NHKItem {
  id: string
  title: string
  description: string
  page_url: string
  updated_at: string
  categories: { name: string }
}

export const fetchNHK = async (source: Source): Promise<FeedItem[]> => {
  const res = await fetch(`${BASE}/nhkworld/data/en/news/all.json`, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  })
  if (!res.ok) throw new Error(`NHK: ${res.status}`)

  const json = (await res.json()) as { data: NHKItem[] }
  return sortDesc(json.data.map(n => item(source, `${BASE}${n.page_url}`, n.title, {
    summary: n.description?.slice(0, 200),
    publishedAt: n.updated_at ? new Date(+n.updated_at).toISOString() : undefined,
  })))
}
