import * as cheerio from 'cheerio'
import { item, sortDesc } from '../lib.ts'
import type { Source, FeedItem, SourceAdapter } from '../types.ts'

export const github: SourceAdapter = {
  type: 'website',
  test: (url: string) => new URL(url).hostname === 'github.com',

  async fetch(source: Source): Promise<FeedItem[]> {
    const { pathname } = new URL(source.url)
    const parts = pathname.replace(/^\//, '').split('/')
    const org = parts[0]
    const repo = parts[1]

    if (repo) return fetchRepoReleases(source, `${org}/${repo}`)

    const repos = await fetchOrgRepos(org!)
    const all = await Promise.all(repos.map(r => fetchRepoReleases(source, r)))
    return sortDesc(all.flat())
  },
}

const fetchRepoReleases = async (source: Source, repo: string): Promise<FeedItem[]> => {
  try {
    const $ = cheerio.load(
      await fetch(`https://github.com/${repo}/releases.atom`).then(r => r.text()),
      { xml: true },
    )
    const items: FeedItem[] = []

    $('entry').each((_, el) => {
      const title = $(el).find('title').text().trim()
      const link = $(el).find('link').attr('href') ?? ''
      if (!title || !link) return
      const updated = $(el).find('updated').text().trim()
      const content = $(el).find('content').text().trim()

      items.push(item(source, link, `${repo.split('/')[1]}: ${title}`, {
        summary: content.replace(/<[^>]*>/g, '').slice(0, 200) || undefined,
        publishedAt: updated ? new Date(updated).toISOString() : undefined,
      }))
    })

    return items
  } catch { return [] }
}

const fetchOrgRepos = async (org: string): Promise<string[]> => {
  try {
    const $ = cheerio.load(
      await fetch(`https://github.com/orgs/${org}/repositories?type=source&sort=pushed`).then(r => r.text()),
    )
    const repos: string[] = []
    $(`a[href^="/${org}/"]`).each((_, el) => {
      const parts = $(el).attr('href')!.replace(/^\//, '').split('/')
      if (parts.length === 2) repos.push(parts.join('/'))
    })
    return [...new Set(repos)].slice(0, 10)
  } catch { return [] }
}
