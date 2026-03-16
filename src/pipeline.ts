import { load, activeSources } from './config.ts'
import { createStore } from './store.ts'
import { resolve } from './adapters/index.ts'
import { retry } from './lib.ts'
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
  ms: number
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

  // Pre-warm DNS cache — fire-and-forget prefetch for all unique hostnames
  const seen = new Set<string>()
  for (const s of sources) {
    try { const h = new URL(s.url).hostname; if (!seen.has(h)) { seen.add(h); Bun.dns.prefetch(h) } } catch {}
  }

  // 12 concurrent workers — queue-based semaphore avoids DNS/TLS congestion
  const CONCURRENCY = 12
  const queue = [...sources]
  const workers: Promise<void>[] = []

  const runNext = async (): Promise<void> => {
    while (queue.length > 0) {
      const source = queue.shift()!
      const adapter = resolve(source.url)
      const t0 = Date.now()
      let result: FetchResult
      try {
        const items = await retry(() => withTimeout(adapter.fetch(source), 30_000), 2, 300)
        const added = store.save(items)
        newItems += added
        result = { name: source.name, count: items.length, added, ms: Date.now() - t0 }
      } catch (e: any) {
        result = { name: source.name, count: 0, added: 0, ms: Date.now() - t0, error: e?.message ?? String(e) }
      }
      results.push(result)
      done++
      opts?.onResult?.(result, done, sources.length)
    }
  }

  for (let i = 0; i < Math.min(CONCURRENCY, sources.length); i++) workers.push(runNext())
  await Promise.all(workers)

  store.close()
  return { newItems, results }
}

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
  Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`timeout ${ms}ms`)), ms))])

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
