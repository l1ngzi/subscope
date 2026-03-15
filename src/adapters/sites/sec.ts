import { createHash } from 'crypto'
import type { Source, FeedItem } from '../../types.ts'

const hash = (...parts: string[]) =>
  createHash('sha256').update(parts.join(':')).digest('hex').slice(0, 12)

const THREE_DAYS = 3 * 24 * 60 * 60 * 1000
const MAX_FILINGS = 30

interface EdgarHit {
  _source: {
    ciks?: string[]
    display_names?: string[]
    form?: string
    file_date?: string
    adsh?: string
    file_description?: string
    items?: string[]
  }
}

export const fetchSEC = async (source: Source): Promise<FeedItem[]> => {
  const url = new URL(source.url)
  // Auto-inject date range for last 3 days, cap results
  url.searchParams.set('dateRange', 'custom')
  url.searchParams.set('startdt', new Date(Date.now() - THREE_DAYS).toISOString().slice(0, 10))
  url.searchParams.set('enddt', new Date().toISOString().slice(0, 10))

  const res = await fetch(url.href, {
    headers: {
      'User-Agent': 'Subscope/1.0 (personal feed aggregator)',
      'Accept': 'application/json',
    },
  })
  if (!res.ok) throw new Error(`SEC EDGAR: ${res.status}`)

  const data = (await res.json()) as { hits?: { hits?: EdgarHit[] } }
  const hits = data?.hits?.hits ?? []

  // Group by accession number — one FeedItem per filing
  const seen = new Map<string, EdgarHit['_source']>()
  for (const hit of hits) {
    const adsh = hit._source.adsh
    if (adsh && !seen.has(adsh)) seen.set(adsh, hit._source)
  }

  const items: FeedItem[] = []
  let count = 0
  for (const [adsh, filing] of seen) {
    if (count >= MAX_FILINGS) break
    count++
    const company = filing.display_names?.[0]?.replace(/\s*\(CIK \d+\)/, '') ?? 'Unknown'
    const form = filing.form ?? '8-K'
    const cik = filing.ciks?.[0]?.replace(/^0+/, '')
    const adshClean = adsh.replace(/-/g, '')
    const filingUrl = cik
      ? `https://www.sec.gov/Archives/edgar/data/${cik}/${adshClean}/${adsh}-index.htm`
      : `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&type=${form}`

    items.push({
      id: hash(source.id, adsh),
      sourceId: source.id,
      sourceType: 'website',
      sourceName: source.name,
      title: `[${form}] ${company}`,
      url: filingUrl,
      summary: filing.file_description || undefined,
      publishedAt: filing.file_date
        ? new Date(filing.file_date + 'T00:00:00-05:00').toISOString()
        : new Date().toISOString(),
    })
  }

  return items.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
}
