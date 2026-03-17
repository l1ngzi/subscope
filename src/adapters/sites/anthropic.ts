import { item, sortDesc, UA } from '../../lib.ts'
import type { Source, FeedItem } from '../../types.ts'

const BASE = 'https://www.anthropic.com'
// Anthropic uses Sanity CMS — GROQ API returns clean JSON, ~1KB vs 350KB RSC HTML
const SANITY = 'https://4zrzovbb.api.sanity.io/v2024-01-01/data/query/website'

const QUERIES: Record<string, { query: string; prefix: string }> = {
  blog: {
    query: '*[_type == "post" && "news" in directories[].value] | order(publishedOn desc) [0...50] { title, slug, publishedOn, summary }',
    prefix: '/news/',
  },
  research: {
    query: '*[_type == "post" && "research" in directories[].value] | order(publishedOn desc) [0...50] { title, slug, publishedOn, summary }',
    prefix: '/research/',
  },
  engineering: {
    query: '*[_type == "engineeringArticle"] | order(_createdAt desc) [0...30] { title, slug, publishedOn, _createdAt, summary }',
    prefix: '/engineering/',
  },
}

export const fetchAnthropic = async (source: Source): Promise<FeedItem[]> => {
  const key = source.url.includes('/research') ? 'research'
    : source.url.includes('/engineering') ? 'engineering'
    : 'blog'
  const { query, prefix } = QUERIES[key]!

  const res = await fetch(`${SANITY}?query=${encodeURIComponent(query)}`, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`Sanity API: ${res.status}`)
  const json = (await res.json()) as any

  return sortDesc((json.result || [])
    .filter((r: any) => r.title && r.slug?.current)
    .map((r: any) => item(source, `${BASE}${prefix}${r.slug.current}`, r.title, {
      summary: r.summary || undefined,
      publishedAt: (r.publishedOn || r._createdAt) ? new Date(r.publishedOn || r._createdAt).toISOString() : undefined,
    })))
}
