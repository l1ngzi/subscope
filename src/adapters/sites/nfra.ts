import { item, sortDesc, UA, TLS } from '../../lib.ts'
import type { Source, FeedItem } from '../../types.ts'

const BASE = 'https://www.nfra.gov.cn'
const API = `${BASE}/cn/static/data/DocInfo/SelectDocByItemIdAndChild/data_itemId=915,pageIndex=1,pageSize=18.json`

export const fetchNFRA = async (source: Source): Promise<FeedItem[]> => {
  const res = await fetch(API, { headers: { 'User-Agent': UA }, ...TLS(source.url) } as any)
  if (!res.ok) throw new Error(`NFRA: ${res.status}`)
  const json = (await res.json()) as any
  if (json.rptCode !== 200 || !json.data?.rows) throw new Error('NFRA: bad response')

  return sortDesc(json.data.rows.map((row: any) => {
    const title = (row.docTitle || row.docSubtitle || '').replace(/\n/g, ' ').trim()
    const url = `${BASE}/cn/view/pages/ItemDetail.html?docId=${row.docId}&itemId=915`
    return item(source, url, title, {
      publishedAt: row.publishDate ? new Date(row.publishDate + '+08:00').toISOString() : undefined,
    })
  }).filter((i: FeedItem) => i.title.length > 0))
}
