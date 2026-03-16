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

export interface FetchResult {
  name: string
  count: number
  added: number
  error?: string
}

export const fetchAll = async (opts?: {
  group?: string
  onResult?: (result: FetchResult, done: number, total: number) => void
}): Promise<{ newItems: number; results: FetchResult[] }> => {
  const config = load()
  const store = createStore()
  const sources = opts?.group
    ? config.sources.filter(s => s.active !== false && (s.group === opts.group || s.group.startsWith(opts.group + '/')))
    : config.sources

  let done = 0
  const results: FetchResult[] = []
  let newItems = 0

  await Promise.allSettled(
    sources.map(async (source) => {
      const adapter = resolve(source.url)
      let result: FetchResult
      try {
        const items = await adapter.fetch(source)
        const added = store.save(items)
        newItems += added
        result = { name: source.name, count: items.length, added }
      } catch (e: any) {
        result = { name: source.name, count: 0, added: 0, error: e?.message ?? String(e) }
      }
      results.push(result)
      done++
      opts?.onResult?.(result, done, sources.length)
    })
  )

  store.close()
  return { newItems, results }
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
