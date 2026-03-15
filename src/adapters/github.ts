import * as cheerio from 'cheerio'
import { createHash } from 'crypto'
import type { Source, FeedItem, SourceAdapter } from '../types.ts'

const hash = (...parts: string[]) =>
  createHash('sha256').update(parts.join(':')).digest('hex').slice(0, 12)

// GitHub org/user release feed via Atom
// Works with: github.com/<org> → fetches all repos' releases

export const github: SourceAdapter = {
  type: 'website',
  test: (url: string) => new URL(url).hostname === 'github.com',

  async fetch(source: Source): Promise<FeedItem[]> {
    const { pathname } = new URL(source.url)
    const parts = pathname.replace(/^\//, '').split('/')
    const org = parts[0]
    const repo = parts[1]

    if (repo) {
      // Single repo: github.com/org/repo
      return fetchRepoReleases(source, `${org}/${repo}`)
    }

    // Org-level: github.com/org — fetch top repos' releases
    const repos = await fetchOrgRepos(org!)
    const all = await Promise.all(
      repos.map(r => fetchRepoReleases(source, r))
    )
    return all.flat().sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
  },
}

const fetchRepoReleases = async (source: Source, repo: string): Promise<FeedItem[]> => {
  const feedUrl = `https://github.com/${repo}/releases.atom`
  try {
    const xml = await fetch(feedUrl).then(r => r.text())
    const $ = cheerio.load(xml, { xml: true })
    const items: FeedItem[] = []

    $('entry').each((_, el) => {
      const title = $(el).find('title').text().trim()
      const link = $(el).find('link').attr('href') ?? ''
      const updated = $(el).find('updated').text().trim()
      const content = $(el).find('content').text().trim()

      if (!title || !link) return

      items.push({
        id: hash(source.id, link),
        sourceId: source.id,
        sourceType: 'website',
        sourceName: source.name,
        title: `${repo.split('/')[1]}: ${title}`,
        url: link,
        summary: content.replace(/<[^>]*>/g, '').slice(0, 200) || undefined,
        publishedAt: updated ? new Date(updated).toISOString() : new Date().toISOString(),
      })
    })

    return items
  } catch {
    return []
  }
}

const fetchOrgRepos = async (org: string): Promise<string[]> => {
  // Use GitHub search to find repos with recent releases
  // Simple approach: scrape the org page for repo links
  try {
    const html = await fetch(`https://github.com/orgs/${org}/repositories?type=source&sort=pushed`).then(r => r.text())
    const $ = cheerio.load(html)
    const repos: string[] = []

    $(`a[href^="/${org}/"]`).each((_, el) => {
      const href = $(el).attr('href')!
      const parts = href.replace(/^\//, '').split('/')
      if (parts.length === 2 && !repos.includes(href.slice(1))) {
        repos.push(parts.join('/'))
      }
    })

    // Top 10 repos to avoid too many requests
    return [...new Set(repos)].slice(0, 10)
  } catch {
    return []
  }
}
