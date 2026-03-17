// ── subscope serve — Ollama-style localhost daemon ──
// Auto-starts on first CLI use. System tray icon on Windows.
// Keeps process alive so DNS/TLS/connection pool stays warm.

import { fetchAll, read, type FetchResult, type ReadOpts } from './pipeline.ts'
import { DIR } from './lib.ts'
import { join } from 'path'
import { writeFileSync, unlinkSync, existsSync, readFileSync } from 'fs'

const PORT_FILE = join(DIR, 'serve.json')
const ICON_PATH = join(import.meta.dir, '..', 'assets', 'icon.ico').replace(/\//g, '\\')

const writePortFile = (port: number) => {
  writeFileSync(PORT_FILE, JSON.stringify({ port, pid: process.pid, startedAt: new Date().toISOString() }))
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

// ── Server ──

export const startServer = (port = 0) => {
  let fetchInProgress = false

  const server = Bun.serve({
    port,
    hostname: '127.0.0.1',

    fetch: async (req) => {
      const url = new URL(req.url)

      if (url.pathname === '/health') {
        return Response.json({ status: 'ok', pid: process.pid, uptime: process.uptime() })
      }

      if (url.pathname === '/fetch') {
        if (fetchInProgress) {
          return Response.json({ error: 'fetch already in progress' }, { status: 409 })
        }
        fetchInProgress = true
        const group = url.searchParams.get('group') ?? undefined

        // SSE stream — push each result as it completes
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
              fetchInProgress = false
              controller.close()
            }
          },
        })
        return new Response(stream, {
          headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
        })
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
        setTimeout(() => process.exit(0), 100)
        return Response.json({ status: 'stopping' })
      }

      return Response.json({ error: 'not found' }, { status: 404 })
    },
  })

  const actualPort = server.port
  writePortFile(actualPort)
  startTray(actualPort)

  process.on('SIGINT', () => { removePortFile(); stopTray(); process.exit(0) })
  process.on('SIGTERM', () => { removePortFile(); stopTray(); process.exit(0) })

  console.log(`\n  subscope serve listening on http://127.0.0.1:${actualPort}`)
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
        if (!match) continue
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
