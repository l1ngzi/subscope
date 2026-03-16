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

export const fetchAll = async (opts?: { group?: string }): Promise<number> => {
  const config = load()
  const store = createStore()
  const sources = opts?.group
    ? config.sources.filter(s => s.active !== false && (s.group === opts.group || s.group.startsWith(opts.group + '/')))
    : config.sources

  // Fetch sources concurrently — result carries its own source reference
  const results = await Promise.allSettled(
    sources.map(async (source) => {
      const adapter = resolve(source.url)
      const items = await adapter.fetch(source)
      return { source, items }
    })
  )

  let total = 0
  let newItems = 0
  for (const result of results) {
    if (result.status === 'fulfilled') {
      const { source, items } = result.value
      const added = store.save(items)
      total += items.length
      newItems += added
      console.log(`  ${source.name} — ${items.length} items${added > 0 ? ` (${added} new)` : ''}`)
    } else {
      console.error(`  failed: ${result.reason}`)
    }
  }

  store.close()
  return newItems
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

  const allItems = store.query({ sourceType: opts.sourceType, sourceIds, since })
  const items = opts.limit ? allItems.slice(0, opts.limit) : allItems
  const olderCount = since
    ? store.count({ sourceType: opts.sourceType, sourceIds, since })
    : 0

  store.close()
  return { items, olderCount }
}
