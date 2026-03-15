import { createHash } from 'crypto'
import type { Source, FeedItem, SourceAdapter } from '../types.ts'

const hash = (...parts: string[]) =>
  createHash('sha256').update(parts.join(':')).digest('hex').slice(0, 12)

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
}

export const youtube: SourceAdapter = {
  type: 'youtube',
  test: (url: string) => {
    const { hostname } = new URL(url)
    return hostname.includes('youtube.com') || hostname.includes('youtu.be')
  },

  async fetch(source: Source): Promise<FeedItem[]> {
    // Ensure URL points to /videos tab
    const pageUrl = source.url.replace(/\/?$/, '/videos')

    const html = await fetch(pageUrl, { headers: HEADERS }).then(r => r.text())
    const match = html.match(/var ytInitialData\s*=\s*(\{.+?\});\s*<\/script/s)
    if (!match) return []

    const data = JSON.parse(match[1]!)
    const tabs: any[] = data.contents?.twoColumnBrowseResultsRenderer?.tabs ?? []
    const videosTab = tabs.find((t: any) => t.tabRenderer?.title === 'Videos')
    const gridItems: any[] = videosTab?.tabRenderer?.content?.richGridRenderer?.contents ?? []

    const items: FeedItem[] = []

    for (const item of gridItems) {
      const v = item.richItemRenderer?.content?.videoRenderer
      if (!v?.videoId || !v?.title?.runs?.[0]?.text) continue

      const videoId = v.videoId
      const title = v.title.runs[0].text
      const relDate = v.publishedTimeText?.simpleText ?? ''
      const desc = v.descriptionSnippet?.runs?.map((r: any) => r.text).join('').slice(0, 200)

      items.push({
        id: hash(source.id, videoId),
        sourceId: source.id,
        sourceType: 'youtube',
        sourceName: source.name,
        title,
        url: `https://www.youtube.com/watch?v=${videoId}`,
        summary: desc || undefined,
        publishedAt: relativeToISO(relDate),
      })
    }

    return items.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
  },
}

// "2 weeks ago" / "1 month ago" / "3 days ago" → ISO date
const relativeToISO = (rel: string): string => {
  const now = Date.now()
  const match = rel.match(/(\d+)\s*(second|minute|hour|day|week|month|year)/)
  if (!match) return new Date(now).toISOString()

  const n = parseInt(match[1]!)
  const unit = match[2]!
  const ms: Record<string, number> = {
    second: 1000,
    minute: 60_000,
    hour: 3_600_000,
    day: 86_400_000,
    week: 604_800_000,
    month: 2_592_000_000,
    year: 31_536_000_000,
  }

  return new Date(now - n * (ms[unit] ?? 86_400_000)).toISOString()
}
