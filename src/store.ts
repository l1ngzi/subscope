import { Database } from 'bun:sqlite'
import { join } from 'path'
import { mkdirSync, existsSync } from 'fs'
import { DIR } from './lib.ts'
import type { FeedItem, SourceType } from './types.ts'

const DB_PATH = join(DIR, 'subscope.db')

export interface QueryOpts {
  limit?: number
  sourceType?: SourceType
  sourceIds?: string[]
  since?: string  // ISO date string
}

export const createStore = (dbPath = DB_PATH) => {
  const dir = join(dbPath, '..')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  const db = new Database(dbPath)

  db.run(`CREATE TABLE IF NOT EXISTS items (
    id TEXT PRIMARY KEY,
    sourceId TEXT NOT NULL,
    sourceType TEXT NOT NULL,
    sourceName TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    summary TEXT,
    publishedAt TEXT NOT NULL
  )`)

  // Migrate: add sourceName column if missing
  try { db.run('ALTER TABLE items ADD COLUMN sourceName TEXT NOT NULL DEFAULT ""') } catch {}

  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO items (id, sourceId, sourceType, sourceName, title, url, summary, publishedAt)
    VALUES ($id, $sourceId, $sourceType, $sourceName, $title, $url, $summary, $publishedAt)
  `)

  return {
    save(items: FeedItem[]): number {
      const before = (db.prepare('SELECT COUNT(*) as n FROM items').get() as { n: number }).n
      const tx = db.transaction(() => {
        for (const item of items) {
          insertStmt.run({
            $id: item.id,
            $sourceId: item.sourceId,
            $sourceType: item.sourceType,
            $sourceName: item.sourceName,
            $title: item.title,
            $url: item.url,
            $summary: item.summary ?? null,
            $publishedAt: item.publishedAt,
          })
        }
      })
      tx()
      const after = (db.prepare('SELECT COUNT(*) as n FROM items').get() as { n: number }).n
      return after - before
    },

    query(opts: QueryOpts = {}): FeedItem[] {
      const { limit, sourceType, sourceIds, since } = opts
      const conditions: string[] = []
      const params: (string | number)[] = []

      if (sourceType) {
        conditions.push('sourceType = ?')
        params.push(sourceType)
      }
      if (sourceIds?.length) {
        conditions.push(`sourceId IN (${sourceIds.map(() => '?').join(',')})`)
        params.push(...sourceIds)
      }
      if (since) {
        conditions.push('publishedAt >= ?')
        params.push(since)
      }

      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
      const limitClause = limit ? `LIMIT ?` : ''
      if (limit) params.push(limit)

      return db
        .prepare(`SELECT * FROM items ${where} ORDER BY publishedAt DESC ${limitClause}`)
        .all(...params) as FeedItem[]
    },

    count(opts: { sourceType?: SourceType; sourceIds?: string[]; since?: string } = {}): number {
      const { sourceType, sourceIds, since } = opts
      const conditions: string[] = []
      const params: (string | number)[] = []

      if (sourceType) {
        conditions.push('sourceType = ?')
        params.push(sourceType)
      }
      if (sourceIds?.length) {
        conditions.push(`sourceId IN (${sourceIds.map(() => '?').join(',')})`)
        params.push(...sourceIds)
      }
      if (since) {
        conditions.push('publishedAt < ?')
        params.push(since)
      }

      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
      return (db.prepare(`SELECT COUNT(*) as n FROM items ${where}`).get(...params) as { n: number }).n
    },

    getByIds(ids: string[]): FeedItem[] {
      if (!ids.length) return []
      const placeholders = ids.map(() => '?').join(',')
      return db.prepare(`SELECT * FROM items WHERE id IN (${placeholders})`).all(...ids) as FeedItem[]
    },

    removeBySource(sourceId: string) {
      db.run('DELETE FROM items WHERE sourceId = ?', [sourceId])
    },

    close() {
      db.close()
    },
  }
}
