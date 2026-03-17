import { item, sortDesc, fetchWithCffi } from '../../lib.ts'
import type { Source, FeedItem } from '../../types.ts'

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
  }
}

export const fetchSEC = async (source: Source): Promise<FeedItem[]> => {
  const url = new URL(source.url)
  url.searchParams.set('dateRange', 'custom')
  url.searchParams.set('startdt', new Date(Date.now() - THREE_DAYS).toISOString().slice(0, 10))
  url.searchParams.set('enddt', new Date().toISOString().slice(0, 10))

  const text = await fetchWithCffi(url.href, 'safari17_0', {
    'Accept': 'application/json',
    'User-Agent': 'Subscope/1.0 (personal feed aggregator)',
  })
  const data = JSON.parse(text) as { hits?: { hits?: EdgarHit[] } }

  // Deduplicate by accession number — one item per filing
  const seen = new Map<string, EdgarHit['_source']>()
  for (const hit of data?.hits?.hits ?? []) {
    const adsh = hit._source.adsh
    if (adsh && !seen.has(adsh)) seen.set(adsh, hit._source)
  }

  const items: FeedItem[] = []
  let count = 0
  for (const [adsh, filing] of seen) {
    if (count++ >= MAX_FILINGS) break
    const company = filing.display_names?.[0]?.replace(/\s*\(CIK \d+\)/, '') ?? 'Unknown'
    const form = filing.form ?? '8-K'
    const cik = filing.ciks?.[0]?.replace(/^0+/, '')
    const adshClean = adsh.replace(/-/g, '')
    const filingUrl = cik
      ? `https://www.sec.gov/Archives/edgar/data/${cik}/${adshClean}/${adsh}-index.htm`
      : `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&type=${form}`

    items.push(item(source, filingUrl, `[${form}] ${company}`, {
      key: adsh,
      summary: filing.file_description || undefined,
      publishedAt: filing.file_date
        ? new Date(filing.file_date + 'T00:00:00-05:00').toISOString()
        : undefined,
    }))
  }

  return sortDesc(items)
}
