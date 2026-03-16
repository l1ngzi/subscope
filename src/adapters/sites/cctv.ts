import { item, sortDesc, UA, TLS } from '../../lib.ts'
import type { Source, FeedItem } from '../../types.ts'

// CCTV JSONP data interface — discovered from inline JS on news.cctv.com
const JSONP_BASE = 'https://news.cctv.com/2019/07/gaiban/cmsdatainterface/page'

interface CCTVItem {
  title: string
  url: string
  focus_date: string
  brief?: string
}

export const fetchCCTV = async (source: Source): Promise<FeedItem[]> => {
  // Extract channel from URL: news.cctv.com/world/ → world, news.cctv.com/china/ → china
  const channel = new URL(source.url).pathname.replace(/\//g, '') || 'world'
  const jsonpUrl = `${JSONP_BASE}/${channel}_1.jsonp`

  const res = await fetch(jsonpUrl, { headers: { 'User-Agent': UA }, ...TLS(jsonpUrl) } as any)
  if (!res.ok) throw new Error(`CCTV: ${res.status}`)

  // JSONP response: callback({data:{list:[...]}})
  const text = await res.text()
  const jsonStr = text.replace(/^[^(]*\(/, '').replace(/\);?\s*$/, '')
  const json = JSON.parse(jsonStr) as { data: { list: CCTVItem[] } }

  return sortDesc(json.data.list
    .filter(n => (n.brief?.length ?? 0) >= 30)
    .map(n => item(source, n.url, n.title, {
      summary: n.brief?.slice(0, 200),
      publishedAt: n.focus_date ? new Date(n.focus_date + '+08:00').toISOString() : undefined,
    })))
}
