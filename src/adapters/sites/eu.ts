import { item, sortDesc, UA } from '../../lib.ts'
import type { Source, FeedItem } from '../../types.ts'

const API = 'https://ec.europa.eu/commission/presscorner/api/search'
const BASE = 'https://ec.europa.eu/commission/presscorner/detail/en'

interface EUItem {
  refCode: string
  title: string
  leadText: string | null
  eventDate: string
  docutype: { code: string; description: string }
}

export const fetchEU = async (source: Source): Promise<FeedItem[]> => {
  // Filter to press releases only (IP code), skip speeches/daily news
  const res = await fetch(`${API}?language=en&pageSize=20&docType=IP`, {
    headers: { 'User-Agent': UA },
  })
  if (!res.ok) throw new Error(`EU: ${res.status}`)

  const json = (await res.json()) as { docuLanguageListResources: EUItem[] }
  return sortDesc(json.docuLanguageListResources.map(n => {
    const url = `${BASE}/${n.refCode.replace(/\//g, '_')}`
    return item(source, url, n.title, {
      summary: n.leadText?.slice(0, 200) ?? undefined,
      publishedAt: n.eventDate ? new Date(`${n.eventDate}T12:00:00Z`).toISOString() : undefined,
    })
  }))
}
