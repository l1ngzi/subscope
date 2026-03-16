import { twitter } from './twitter.ts'
import { youtube } from './youtube.ts'
import { github } from './github.ts'
import { website } from './website.ts'
import { fetchAnthropic } from './sites/anthropic.ts'
import { fetchClaude } from './sites/claude.ts'
import { fetchDeepSeek } from './sites/deepseek.ts'
import { fetchXai } from './sites/xai.ts'
import { fetchSupportCollection, fetchReleaseNotes } from './sites/support-claude.ts'
import { fetchPBOC } from './sites/pboc.ts'
import { fetchNBS } from './sites/nbs.ts'
import { fetchSEC } from './sites/sec.ts'
import { fetchBEA } from './sites/bea.ts'
import { fetchBLS } from './sites/bls.ts'
import { fetchTreasury } from './sites/treasury.ts'
import { fetchIMF } from './sites/imf.ts'
import { fetchMOF } from './sites/mof.ts'
import { fetchSAFE } from './sites/safe.ts'
import { fetchNFRA } from './sites/nfra.ts'
import { fetchCSRC } from './sites/csrc.ts'
import { fetchNHK } from './sites/nhk.ts'
import { fetchPeople } from './sites/people.ts'
import { fetchCCTV } from './sites/cctv.ts'
import { fetchXinhua } from './sites/xinhua.ts'
import { fetchBOJ } from './sites/boj.ts'
import { fetchAPNews } from './sites/apnews.ts'
import { fetchEIA } from './sites/eia.ts'
import { fetchIAEA } from './sites/iaea.ts'
import { fetchWTO } from './sites/wto.ts'
import { fetchFTC } from './sites/ftc.ts'
import { fetchEU } from './sites/eu.ts'
import { fetchOPEC } from './sites/opec.ts'
import { fetchIRENA } from './sites/irena.ts'
import type { SourceAdapter, SourceType } from '../types.ts'

// Site-specific adapters — matched by (hostname, pathPrefix)
// More specific rules first
const siteRules: { host: string; path?: string; fetch: SourceAdapter['fetch'] }[] = [
  { host: 'support.claude.com', path: '/en/articles/12138966', fetch: fetchReleaseNotes },
  { host: 'support.claude.com', path: '/en/collections/', fetch: fetchSupportCollection },
  { host: 'x.ai', fetch: fetchXai },
  { host: 'api-docs.deepseek.com', fetch: fetchDeepSeek },
  { host: 'claude.com', fetch: fetchClaude },
  { host: 'anthropic.com', fetch: fetchAnthropic },
  { host: 'pbc.gov.cn', fetch: fetchPBOC },
  { host: 'stats.gov.cn', fetch: fetchNBS },
  { host: 'efts.sec.gov', fetch: fetchSEC },
  { host: 'bea.gov', fetch: fetchBEA },
  { host: 'bls.gov', fetch: fetchBLS },
  { host: 'home.treasury.gov', fetch: fetchTreasury },
  { host: 'imf.org', fetch: fetchIMF },
  { host: 'mof.gov.cn', fetch: fetchMOF },
  { host: 'safe.gov.cn', fetch: fetchSAFE },
  { host: 'nfra.gov.cn', fetch: fetchNFRA },
  { host: 'csrc.gov.cn', fetch: fetchCSRC },
  { host: 'nhk.or.jp', path: '/nhkworld/', fetch: fetchNHK },
  { host: 'people.com.cn', fetch: fetchPeople },
  { host: 'news.cctv.com', fetch: fetchCCTV },
  { host: 'news.cn', fetch: fetchXinhua },
  { host: 'boj.or.jp', fetch: fetchBOJ },
  { host: 'apnews.com', fetch: fetchAPNews },
  { host: 'eia.gov', fetch: fetchEIA },
  { host: 'iaea.org', path: '/newscenter/', fetch: fetchIAEA },
  { host: 'wto.org', fetch: fetchWTO },
  { host: 'ftc.gov', fetch: fetchFTC },
  { host: 'ec.europa.eu', path: '/commission/presscorner/', fetch: fetchEU },
  { host: 'opec.org', fetch: fetchOPEC },
  { host: 'irena.org', fetch: fetchIRENA },
]

const matchSite = (url: string): SourceAdapter['fetch'] | undefined => {
  const { hostname, pathname } = new URL(url)
  for (const rule of siteRules) {
    if (!hostname.includes(rule.host)) continue
    if (rule.path && !pathname.startsWith(rule.path)) continue
    return rule.fetch
  }
}

// Generic adapters — ordered by specificity, website is the fallback
const adapters: SourceAdapter[] = [
  twitter,
  youtube,
  github,
  website,
]

export const resolve = (url: string): SourceAdapter => {
  const siteFetcher = matchSite(url)
  if (siteFetcher) {
    return { type: 'website', test: () => true, fetch: siteFetcher }
  }
  return adapters.find(a => a.test(url))!
}

export const detectType = (url: string): SourceType => {
  const { hostname } = new URL(url)
  if (hostname.includes('youtube.com') || hostname.includes('youtu.be')) return 'youtube'
  if (hostname.includes('twitter.com') || hostname.includes('x.com')) return 'twitter'
  return 'website'
}
