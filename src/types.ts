export type SourceType = 'website' | 'youtube' | 'twitter'

export interface Source {
  id: string
  url: string
  type: SourceType
  name: string
  group: string
  active: boolean
  addedAt: string
}

export interface FeedItem {
  id: string
  sourceId: string
  sourceType: SourceType
  sourceName: string
  title: string
  url: string
  summary?: string
  publishedAt: string
}

export interface SourceAdapter {
  type: SourceType
  test(url: string): boolean
  fetch(source: Source): Promise<FeedItem[]>
}
