// ── subscope serve — Ollama-style localhost server ──
// Keeps process alive so DNS/TLS/connection pool stays warm.
// CLI detects running server and proxies requests through it.

import { fetchAll, read, type FetchResult, type ReadOpts } from './pipeline.ts'
import { DIR } from './lib.ts'
import { join } from 'path'
import { writeFileSync, unlinkSync } from 'fs'

const PORT_FILE = join(DIR, 'serve.json')

const writePortFile = (port: number) => {
  writeFileSync(PORT_FILE, JSON.stringify({ port, pid: process.pid, startedAt: new Date().toISOString() }))
}

const removePortFile = () => {
  try { unlinkSync(PORT_FILE) } catch {}
}

export const startServer = (port = 0) => {
  let fetchInProgress = false

  const server = Bun.serve({
    port,
    hostname: '127.0.0.1',

    fetch: async (req) => {
      const url = new URL(req.url)

      // ── Health check ──
      if (url.pathname === '/health') {
        return Response.json({ status: 'ok', pid: process.pid, uptime: process.uptime() })
      }

      // ── Fetch sources ──
      if (url.pathname === '/fetch') {
        if (fetchInProgress) {
          return Response.json({ error: 'fetch already in progress' }, { status: 409 })
        }
        fetchInProgress = true
        try {
          const group = url.searchParams.get('group') ?? undefined
          const results: FetchResult[] = []
          const { newItems } = await fetchAll({
            group,
            concurrency: Infinity, // no limit — serve keeps connections warm, bounded by BUN_CONFIG_MAX_HTTP_REQUESTS
            onResult: (r) => results.push(r),
          })
          return Response.json({ newItems, results })
        } finally {
          fetchInProgress = false
        }
      }

      // ── Read items ──
      if (url.pathname === '/read') {
        const opts: ReadOpts = {}
        if (url.searchParams.has('limit')) opts.limit = parseInt(url.searchParams.get('limit')!)
        if (url.searchParams.has('group')) opts.group = url.searchParams.get('group')!
        if (url.searchParams.has('mode')) opts.mode = url.searchParams.get('mode')!
        if (url.searchParams.has('sourceType')) opts.sourceType = url.searchParams.get('sourceType') as any
        if (url.searchParams.has('since')) opts.since = url.searchParams.get('since')!
        if (url.searchParams.get('all') === 'true') opts.all = true
        const { items, olderCount } = read(opts)
        return Response.json({ items, olderCount })
      }

      // ── Stop server ──
      if (url.pathname === '/stop') {
        removePortFile()
        setTimeout(() => process.exit(0), 100)
        return Response.json({ status: 'stopping' })
      }

      return Response.json({ error: 'not found' }, { status: 404 })
    },
  })

  const actualPort = server.port
  writePortFile(actualPort)

  // Cleanup on exit
  process.on('SIGINT', () => { removePortFile(); process.exit(0) })
  process.on('SIGTERM', () => { removePortFile(); process.exit(0) })

  console.log(`\n  subscope serve listening on http://127.0.0.1:${actualPort}`)
  console.log(`  PID ${process.pid} · stop with: subscope serve stop\n`)

  return server
}

/** Check if server is running, return port or null */
export const getServerPort = (): number | null => {
  try {
    const data = JSON.parse(require('fs').readFileSync(PORT_FILE, 'utf-8'))
    return data.port ?? null
  } catch {
    return null
  }
}

/** Proxy a fetch request to the running server */
export const proxyFetch = async (port: number, opts?: { group?: string }): Promise<{
  newItems: number
  results: FetchResult[]
} | null> => {
  const params = opts?.group ? `?group=${encodeURIComponent(opts.group)}` : ''
  try {
    const res = await fetch(`http://127.0.0.1:${port}/fetch${params}`, { timeout: 120_000 } as any)
    if (!res.ok) return null
    return await res.json() as any
  } catch {
    // Server not actually running, stale port file
    removePortFile()
    return null
  }
}
