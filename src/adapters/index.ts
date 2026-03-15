import { twitter } from './twitter.ts'
import { youtube } from './youtube.ts'
import { github } from './github.ts'
import { website } from './website.ts'
import { fetchAnthropic } from './sites/anthropic.ts'
import { fetchClaude } from './sites/claude.ts'
import { fetchDeepSeek } from './sites/deepseek.ts'
import { fetchSupportCollection, fetchReleaseNotes } from './sites/support-claude.ts'
import type { SourceAdapter, SourceType } from '../types.ts'

// Site-specific adapters — matched by (hostname, pathPrefix)
// More specific rules first
const siteRules: { host: string; path?: string; fetch: SourceAdapter['fetch'] }[] = [
  { host: 'support.claude.com', path: '/en/articles/12138966', fetch: fetchReleaseNotes },
  { host: 'support.claude.com', path: '/en/collections/', fetch: fetchSupportCollection },
  { host: 'api-docs.deepseek.com', fetch: fetchDeepSeek },
  { host: 'claude.com', fetch: fetchClaude },
  { host: 'anthropic.com', fetch: fetchAnthropic },
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
