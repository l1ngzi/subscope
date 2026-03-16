import { item, sortDesc } from '../lib.ts'
import type { Source, FeedItem, SourceAdapter } from '../types.ts'

export const youtube: SourceAdapter = {
  type: 'youtube',
  test: (url: string) => {
    const { hostname } = new URL(url)
    return hostname.includes('youtube.com') || hostname.includes('youtu.be')
  },

  async fetch(source: Source): Promise<FeedItem[]> {
    const pageUrl = source.url.replace(/\/?$/, '/videos')
    const html = await fetch(pageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    }).then(r => r.text())

    const match = html.match(/var ytInitialData\s*=\s*(\{.+?\});\s*<\/script/s)
    if (!match) return []

    const data = JSON.parse(match[1]!)
    const tabs: any[] = data.contents?.twoColumnBrowseResultsRenderer?.tabs ?? []
    const videosTab = tabs.find((t: any) => t.tabRenderer?.title === 'Videos')
    const gridItems: any[] = videosTab?.tabRenderer?.content?.richGridRenderer?.contents ?? []

    const items: FeedItem[] = []
    for (const gridItem of gridItems) {
      const v = gridItem.richItemRenderer?.content?.videoRenderer
      if (!v?.videoId || !v?.title?.runs?.[0]?.text) continue

      items.push(item(source, `https://www.youtube.com/watch?v=${v.videoId}`, v.title.runs[0].text, {
        key: v.videoId,
        summary: v.descriptionSnippet?.runs?.map((r: any) => r.text).join('').slice(0, 200) || undefined,
        publishedAt: relativeToISO(v.publishedTimeText?.simpleText ?? ''),
      }))
    }

    return sortDesc(items)
  },
}

// "2 weeks ago" → ISO date
const relativeToISO = (rel: string): string => {
  const match = rel.match(/(\d+)\s*(second|minute|hour|day|week|month|year)/)
  if (!match) return new Date().toISOString()

  const n = parseInt(match[1]!)
  const ms: Record<string, number> = {
    second: 1000, minute: 60_000, hour: 3_600_000, day: 86_400_000,
    week: 604_800_000, month: 2_592_000_000, year: 31_536_000_000,
  }
  return new Date(Date.now() - n * (ms[match[2]!] ?? 86_400_000)).toISOString()
}
