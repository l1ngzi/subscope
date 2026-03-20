// ── subscope serve — Ollama-style localhost daemon ──
// Auto-starts on first CLI use. System tray icon on Windows.
// Keeps process alive so DNS/TLS/connection pool stays warm.

import { fetchAll, read, type FetchResult, type ReadOpts } from './pipeline.ts'
import { load } from './config.ts'
import { createStore } from './store.ts'
import { readArticle } from './reader/index.ts'
import { DIR } from './lib.ts'
import { join } from 'path'
import { writeFileSync, unlinkSync, existsSync, readFileSync } from 'fs'

const PORT_FILE = join(DIR, 'serve.json')
const ICON_PATH = join(import.meta.dir, '..', 'assets', 'icon.ico').replace(/\//g, '\\')

const writePortFile = (port: number, fetchApiPort?: number) => {
  writeFileSync(
    PORT_FILE,
    JSON.stringify({
      port,
      ...(fetchApiPort ? { fetchApiPort } : {}),
      pid: process.pid,
      startedAt: new Date().toISOString(),
    })
  )
}

const removePortFile = () => {
  try { unlinkSync(PORT_FILE) } catch {}
}

// ── System tray (Windows) ──

let trayProc: any = null

const startTray = (port: number) => {
  const ps = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$icon = New-Object System.Drawing.Icon("${ICON_PATH}")
$tray = New-Object System.Windows.Forms.NotifyIcon
$tray.Icon = $icon
$tray.Text = "subscope · port ${port}"
$tray.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$status = $menu.Items.Add("subscope running")
$status.Enabled = $false
$menu.Items.Add("-")
$stop = $menu.Items.Add("Stop server")
$stop.Add_Click({
  try { Invoke-WebRequest -Uri "http://127.0.0.1:${port}/stop" -UseBasicParsing -TimeoutSec 2 | Out-Null } catch {}
  $tray.Visible = $false
  $tray.Dispose()
  [System.Windows.Forms.Application]::Exit()
})
$tray.ContextMenuStrip = $menu

[System.Windows.Forms.Application]::Run()
`
  trayProc = Bun.spawn(['powershell', '-NoProfile', '-WindowStyle', 'Hidden', '-Command', ps], {
    stdout: 'ignore', stderr: 'ignore',
  })
}

const stopTray = () => {
  try { trayProc?.kill() } catch {}
}

// ── Fetch SSE (shared by localhost + optional external API port) ──

type FetchLock = { busy: boolean }

const createFetchSseResponse = (lock: FetchLock, group?: string): Response => {
  if (lock.busy) {
    return Response.json({ error: 'fetch already in progress' }, { status: 409 })
  }
  lock.busy = true
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: any) => controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`))
      try {
        const { newItems, results } = await fetchAll({
          group,
          concurrency: Infinity,
          onResult: (r, done, total) => send({ type: 'result', r, done, total }),
        })
        send({ type: 'done', newItems, count: results.length })
      } finally {
        lock.busy = false
        controller.close()
      }
    },
  })
  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
  })
}

const corsApiHeaders = (): Record<string, string> => ({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
})

const externalFetchAuthorized = (req: Request, url: URL, token: string | undefined): boolean => {
  if (!token) return true
  const auth = req.headers.get('authorization')
  if (auth === `Bearer ${token}`) return true
  const q = url.searchParams.get('token')
  if (q === token) return true
  return false
}

// ── Server ──

export const startServer = (port = 0, opts?: { fetchApiPort?: number }) => {
  const fetchLock: FetchLock = { busy: false }
  const fetchApiPort = opts?.fetchApiPort && opts.fetchApiPort > 0 ? opts.fetchApiPort : 0
  const fetchApiToken = process.env.SUBSCOPE_FETCH_TOKEN?.trim() || undefined
  let fetchApiServer: ReturnType<typeof Bun.serve> | null = null

  const server = Bun.serve({
    port,
    hostname: '127.0.0.1',

    fetch: async (req) => {
      const url = new URL(req.url)

      if (url.pathname === '/health') {
        return Response.json({ status: 'ok', pid: process.pid, uptime: process.uptime() })
      }

      if (url.pathname === '/config') {
        const config = load()
        return Response.json(config)
      }

      if (url.pathname === '/items') {
        const sourceId = url.searchParams.get('sourceId') ?? url.searchParams.get('id')
        const n = parseInt(url.searchParams.get('limit') ?? url.searchParams.get('n') ?? '10')
        if (!sourceId) {
          return Response.json({ error: 'missing sourceId' }, { status: 400 })
        }
        const store = createStore()
        const items = store.query({ sourceIds: [sourceId], limit: Math.max(1, Math.min(n, 500)) })
        store.close()
        return Response.json({ items })
      }

      if (url.pathname === '/content') {
        let rawIds: string[] = url.searchParams.getAll('itemId').concat(
          (url.searchParams.get('itemIds') ?? '').split(/[,;\s]+/).filter(Boolean)
        )
        if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.headers.get('content-type')?.includes('application/json')) {
          try {
            const body = (await req.json()) as any
            const fromBody = Array.isArray(body) ? body : (body?.itemIds ?? body?.itemId ? [body.itemId].flat() : [])
            rawIds = rawIds.concat(fromBody.map((id: any) => String(id).trim()).filter(Boolean))
          } catch {}
        }
        if (!rawIds.length) {
          return Response.json({ error: 'missing itemId(s)' }, { status: 400 })
        }
        const itemIds = [...new Set(rawIds)].slice(0, 20)
        const store = createStore()
        const items = store.getByIds(itemIds)
        store.close()
        const notFound = itemIds.filter((id) => !items.some((it) => it.id === id))
        const results = await Promise.allSettled(
          items.map(async (item) => {
            const { title, text } = await readArticle(item.url)
            return { itemId: item.id, url: item.url, title, text }
          })
        )
        const contents = results.map((r, i) =>
          r.status === 'fulfilled' ? r.value : { itemId: items[i]!.id, error: (r as PromiseRejectedResult).reason?.message }
        )
        return Response.json({ contents, notFound })
      }

      if (url.pathname === '/fetch') {
        const group = url.searchParams.get('group') ?? undefined
        return createFetchSseResponse(fetchLock, group)
      }

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

      if (url.pathname === '/stop') {
        removePortFile()
        stopTray()
        try { fetchApiServer?.stop() } catch {}
        setTimeout(() => process.exit(0), 100)
        return Response.json({ status: 'stopping' })
      }

      return Response.json({ error: 'not found' }, { status: 404 })
    },
  })

  const actualPort = server.port ?? port
  if (actualPort === 0) throw new Error('Server could not bind to a port')
  if (fetchApiPort > 0 && fetchApiPort === actualPort) {
    throw new Error(`fetch API port ${fetchApiPort} must differ from main serve port`)
  }

  if (fetchApiPort > 0) {
    fetchApiServer = Bun.serve({
      port: fetchApiPort,
      hostname: '0.0.0.0',
      fetch: async (req) => {
        const url = new URL(req.url)
        if (req.method === 'OPTIONS') {
          return new Response(null, { status: 204, headers: corsApiHeaders() })
        }
        if (!externalFetchAuthorized(req, url, fetchApiToken)) {
          return Response.json({ error: 'unauthorized' }, { status: 401, headers: corsApiHeaders() })
        }
        if (url.pathname === '/health') {
          return Response.json(
            { status: 'ok', pid: process.pid, uptime: process.uptime(), role: 'fetch-api' },
            { headers: corsApiHeaders() }
          )
        }
        if (url.pathname === '/fetch') {
          const group = url.searchParams.get('group') ?? undefined
          const res = createFetchSseResponse(fetchLock, group)
          const h = new Headers(res.headers)
          for (const [k, v] of Object.entries(corsApiHeaders())) h.set(k, v)
          return new Response(res.body, { status: res.status, headers: h })
        }
        return Response.json({ error: 'not found' }, { status: 404, headers: corsApiHeaders() })
      },
    })
  }

  writePortFile(actualPort, fetchApiPort > 0 ? fetchApiPort : undefined)
  startTray(actualPort)

  process.on('SIGINT', () => { removePortFile(); stopTray(); fetchApiServer?.stop(); process.exit(0) })
  process.on('SIGTERM', () => { removePortFile(); stopTray(); fetchApiServer?.stop(); process.exit(0) })

  console.log(`\n  subscope serve listening on http://127.0.0.1:${actualPort}`)
  if (fetchApiPort > 0) {
    console.log(`  fetch API (all interfaces) · http://0.0.0.0:${fetchApiPort}/fetch  SSE, same protocol as localhost`)
    if (fetchApiToken) console.log(`  fetch API auth: Bearer token or ?token=  (SUBSCOPE_FETCH_TOKEN)`)
    else console.log(`  \x1b[33mwarning:\x1b[0m fetch API has no token — set SUBSCOPE_FETCH_TOKEN for production`)
  }
  console.log(`  PID ${process.pid} · stop with: subscope serve stop\n`)

  return server
}

/** Check if server is running, return port or null */
export const getServerPort = (): number | null => {
  try {
    const data = JSON.parse(readFileSync(PORT_FILE, 'utf-8'))
    return data.port ?? null
  } catch {
    return null
  }
}

/** Check if serve is alive, if not start it in background and wait */
export const ensureServe = async (): Promise<number> => {
  // Already running?
  const existing = getServerPort()
  if (existing) {
    try {
      const res = await fetch(`http://127.0.0.1:${existing}/health`, { signal: AbortSignal.timeout(1000) })
      if (res.ok) return existing
    } catch {}
  }

  // Start serve as hidden background process (Windows)
  const bun = join(process.env.HOME || process.env.USERPROFILE || '', '.bun', 'bin', 'bun.exe').replace(/\//g, '\\')
  const cli = join(import.meta.dir, 'cli.ts').replace(/\//g, '\\')
  Bun.spawnSync(['powershell', '-NoProfile', '-Command',
    `Start-Process -FilePath '${bun}' -ArgumentList 'run','${cli}','serve' -WindowStyle Hidden`
  ], { stdout: 'ignore', stderr: 'ignore' })

  // Wait for it to be ready (up to 5s)
  for (let i = 0; i < 50; i++) {
    await new Promise(r => setTimeout(r, 100))
    const port = getServerPort()
    if (port) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(500) })
        if (res.ok) return port
      } catch {}
    }
  }

  throw new Error('Failed to start serve')
}

/** Proxy a fetch request to the running server via SSE */
export const proxyFetch = async (port: number, opts?: {
  group?: string
  onResult?: (r: FetchResult, done: number, total: number) => void
}): Promise<{ newItems: number; count: number } | null> => {
  const params = opts?.group ? `?group=${encodeURIComponent(opts.group)}` : ''
  try {
    const res = await fetch(`http://127.0.0.1:${port}/fetch${params}`, { timeout: 120_000 } as any)
    if (!res.ok) return null

    const reader = res.body?.getReader()
    if (!reader) return null
    const decoder = new TextDecoder()
    let buffer = ''
    let result: { newItems: number; count: number } | null = null

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n\n')
      buffer = lines.pop()!
      for (const line of lines) {
        const match = line.match(/^data: (.+)$/m)
        if (!match?.[1]) continue
        const data = JSON.parse(match[1])
        if (data.type === 'result') {
          opts?.onResult?.(data.r, data.done, data.total)
        } else if (data.type === 'done') {
          result = { newItems: data.newItems, count: data.count }
        }
      }
    }
    return result
  } catch {
    removePortFile()
    return null
  }
}
