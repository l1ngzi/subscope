import { load, activeSources } from './config.ts'
import { createStore } from './store.ts'
import { resolve } from './adapters/index.ts'
import type { FeedItem, SourceType } from './types.ts'

export interface ReadOpts {
  limit?: number
  sourceType?: SourceType
  since?: string
  all?: boolean
  group?: string
  mode?: string
}

export const fetchAll = async (): Promise<number> => {
  const config = load()
  const store = createStore()

  // Fetch all sources concurrently
  const results = await Promise.allSettled(
    config.sources.map(async (source) => {
      const adapter = resolve(source.url)
      const items = await adapter.fetch(source)
      return { source, items }
    })
  )

  let total = 0
  for (const result of results) {
    if (result.status === 'fulfilled') {
      const { source, items } = result.value
      store.save(items)
      total += items.length
      console.log(`  ${source.name} — ${items.length} items`)
    } else {
      console.error(`  failed: ${result.reason}`)
    }
  }

  store.close()
  return total
}

const TWO_WEEKS = 14 * 24 * 60 * 60 * 1000

export const read = (opts: ReadOpts = {}): { items: FeedItem[]; olderCount: number } => {
  const config = load()
  // -g bypasses mode filtering — show everything in that group
  const mode = opts.group ? undefined : (opts.mode ?? config.defaultMode)
  const sources = activeSources(config, { group: opts.group, mode })
  const sourceIds = sources.map(s => s.id)

  if (sourceIds.length === 0) {
    return { items: [], olderCount: 0 }
  }

  const store = createStore()

  const since = opts.all
    ? undefined
    : (opts.since ?? new Date(Date.now() - TWO_WEEKS).toISOString())

  // Query without limit, filter by active sources, then apply limit
  const allItems = store
    .query({ sourceType: opts.sourceType, since })
    .filter(item => sourceIds.includes(item.sourceId))

  const items = opts.limit ? allItems.slice(0, opts.limit) : allItems

  const olderCount = since
    ? store.query({ sourceType: opts.sourceType }).filter(item =>
        sourceIds.includes(item.sourceId) && item.publishedAt < since
      ).length
    : 0

  store.close()
  return { items, olderCount }
}
