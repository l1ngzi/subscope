#!/usr/bin/env bun

import { load, save } from './config.ts'
import { createStore } from './store.ts'
import { fetchAll, read, type ReadOpts } from './pipeline.ts'
import type { SourceType } from './types.ts'
import { renderFeed, renderInteractive, renderSources, renderGroups, formatSourceName } from './render.ts'
import { interactiveConfig } from './interactive.ts'
import { notify } from './notify.ts'
import { readArticle } from './reader/index.ts'
import { DIR, groupMatches } from './lib.ts'

import { join } from 'path'
import { homedir } from 'os'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { parse as yamlParse, stringify as yamlStringify } from 'yaml'
import type { Source } from './types.ts'

const [command, ...args] = process.argv.slice(2)

// ── Auth helpers ──

const authFile = join(DIR, 'auth.yml')

const loadAuth = (): any => {
  if (!existsSync(authFile)) return {}
  try {
    return yamlParse(readFileSync(authFile, 'utf-8')) ?? {}
  } catch (e: any) {
    console.error(`  Warning: failed to parse ${authFile}: ${e.message}`)
    return {}
  }
}

const saveAuth = (auth: any) => {
  if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true })
  writeFileSync(authFile, yamlStringify(auth))
}

const readClipboard = (): string => {
  const clip = Bun.spawnSync(['powershell', '-NoProfile', '-Command', 'Get-Clipboard'], { stdout: 'pipe' })
  return new TextDecoder().decode(clip.stdout).replace(/[\r\n]+/g, ' ').trim()
}

// ── Commands ──

const commands: Record<string, () => Promise<void>> = {
  ls: async () => renderSources(load().sources),

  fetch: async () => {
    const config = load()
    if (config.sources.length === 0) {
      console.log('\n  No sources to fetch. Add one with: subscope add <url>\n')
      return
    }
    let group: string | undefined
    for (let i = 0; i < args.length; i++)
      if ((args[i] === '-g' || args[i] === '--group') && args[i + 1]) group = args[++i]!
    const silent = args.includes('--notify')

    const start = Date.now()
    const spin = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏']
    let frame = 0, spinning = false

    if (!silent) {
      console.log(`\n  ${spin[0]} fetching...`)
      spinning = true
    }
    const timer = spinning ? setInterval(() => {
      frame = (frame + 1) % spin.length
      console.log(`\x1b[1A\x1b[2K  ${spin[frame]} fetching...`)
    }, 80) : null

    const { newItems, results } = await fetchAll({
      group,
      onResult: silent ? undefined : (r, done, total) => {
        if (spinning) { spinning = false; clearInterval(timer!) }
        const up = done === 1 ? '\x1b[1A\x1b[2K' : ''
        if (r.error) {
          console.log(`${up}  \x1b[31m✗\x1b[0m ${formatSourceName(r.name)} \x1b[2m— ${r.error}\x1b[0m`)
        } else {
          const tag = r.added > 0 ? ` \x1b[32m(${r.added} new)\x1b[0m` : ''
          console.log(`${up}  \x1b[90m${done}/${total}\x1b[0m ${formatSourceName(r.name)} \x1b[2m— ${r.count}\x1b[0m${tag}`)
        }
      },
    })

    const elapsed = ((Date.now() - start) / 1000).toFixed(1)

    if (silent) {
      if (newItems > 0) notify('subscope', `${newItems} new item${newItems > 1 ? 's' : ''}`)
    } else {
      console.log(`\n  \x1b[1m${results.length} sources · ${elapsed}s · ${newItems} new\x1b[0m\n`)
    }
  },

  watch: async () => {
    const DEFAULT_WATCH_INTERVAL = 10 // minutes
    const minutes = parseInt(args[0] ?? String(DEFAULT_WATCH_INTERVAL))
    console.log(`\n  Watching every ${minutes}m. Ctrl+C to stop.\n`)

    const tick = async () => {
      const time = new Date().toLocaleTimeString()
      process.stdout.write(`  [${time}] Fetching... `)
      const { newItems } = await fetchAll().catch(() => ({ newItems: 0, results: [] }))
      process.stdout.write(`${newItems} new\n`)
      if (newItems > 0) notify('subscope', `${newItems} new item${newItems > 1 ? 's' : ''}`)
    }

    await tick()
    setInterval(tick, minutes * 60_000)
    await new Promise(() => {})
  },

  'watch-install': async () => {
    const minutes = parseInt(args[0] ?? '10') // default same as watch
    const bun = join(homedir(), '.bun', 'bin', 'bun.exe').replace(/\//g, '\\')
    const cli = join(import.meta.dir, 'cli.ts').replace(/\//g, '\\')

    const ps = `
$action = New-ScheduledTaskAction -Execute "powershell" -Argument "-NoProfile -WindowStyle Hidden -Command & '${bun}' '${cli}' fetch --notify"
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes ${minutes}) -RepetitionDuration ([TimeSpan]::MaxValue)
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
Register-ScheduledTask -TaskName "subscope" -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
Write-Output "ok"
`
    const result = Bun.spawnSync(['powershell', '-NoProfile', '-Command', ps])
    if (new TextDecoder().decode(result.stdout).trim() === 'ok') {
      console.log(`\n  Installed. subscope will fetch every ${minutes}m in the background.`)
      console.log(`  New items trigger a Windows notification.`)
      console.log(`  Remove with: subscope watch-uninstall\n`)
    } else {
      console.error('\n  Failed to create scheduled task. Try running as administrator.\n')
    }
  },

  'watch-uninstall': async () => {
    Bun.spawnSync(['powershell', '-NoProfile', '-Command',
      'Unregister-ScheduledTask -TaskName "subscope" -Confirm:$false 2>$null; Write-Output "ok"'])
    console.log('\n  Scheduled task removed.\n')
  },

  group: async () => {
    const config = load()
    const sub = args[0]

    if (!sub) { renderGroups(config); return }

    const action = args[1]
    const allGroups = [...new Set(config.sources.map(s => s.group))]

    if (!action) {
      const sources = config.sources.filter(s => groupMatches(s.group, sub))
      if (sources.length === 0) { console.log(`\n  Group "${sub}" not found or empty.\n`); return }
      renderSources(sources)
      return
    }

    if (action === 'on') {
      const matching = allGroups.filter(g => groupMatches(g, sub))
      if (matching.length === 0) { console.log(`\n  No groups matching "${sub}".\n`); return }
      for (const g of matching) if (!config.activeGroups.includes(g)) config.activeGroups.push(g)
      save(config)
      console.log(`\n  Activated: ${matching.join(', ')}\n`)
      return
    }

    if (action === 'off') {
      const before = config.activeGroups.length
      config.activeGroups = config.activeGroups.filter(g => !groupMatches(g, sub))
      save(config)
      const removed = before - config.activeGroups.length
      console.log(`\n  Deactivated ${removed} group${removed !== 1 ? 's' : ''} matching "${sub}".\n`)
      return
    }

    if (action === 'add' && args[2]) {
      const source = config.sources.find(s => s.id === args[2])
      if (!source) { console.error('Source not found.'); process.exit(1) }
      source.group = sub
      if (!config.activeGroups.includes(sub)) config.activeGroups.push(sub)
      save(config)
      console.log(`\n  Moved "${source.name}" → [${sub}]\n`)
      return
    }

    console.error('Usage: subscope group [name] [on|off|add <id>]')
  },

  on: async () => {
    const target = args[0]
    if (!target) { console.error('Usage: subscope on <id>'); process.exit(1) }
    const config = load()
    const source = config.sources.find(s => s.id === target)
    if (!source) { console.error('Source not found.'); process.exit(1) }
    source.active = true; save(config)
    console.log(`\n  Activated: ${source.name}\n`)
  },

  off: async () => {
    const target = args[0]
    if (!target) { console.error('Usage: subscope off <id>'); process.exit(1) }
    const config = load()
    const source = config.sources.find(s => s.id === target)
    if (!source) { console.error('Source not found.'); process.exit(1) }
    source.active = false; save(config)
    console.log(`\n  Deactivated: ${source.name}\n`)
  },

  // Alias: subscope toggle <id>
  toggle: async () => {
    const target = args[0]
    if (!target) { console.error('Usage: subscope toggle <id>'); process.exit(1) }
    const config = load()
    const source = config.sources.find(s => s.id === target)
    if (!source) { console.error('Source not found.'); process.exit(1) }
    source.active = !source.active; save(config)
    console.log(`\n  ${source.active ? 'Activated' : 'Deactivated'}: ${source.name}\n`)
  },

  config: async () => { await interactiveConfig() },

  auth: async () => {
    const service = args[0]
    if (!service || !['x', 'academic'].includes(service)) {
      console.log('\n  subscope auth x <token>        X/Twitter auth_token cookie')
      console.log('  subscope auth academic <cookies>  Academic publisher cookies\n')
      return
    }

    if (service === 'academic') {
      let cookies = args.slice(1).join(' ')
      if (!cookies) {
        const clip = readClipboard()
        if (clip.includes('=') && clip.length > 20) {
          cookies = clip
          console.log('\n  Read cookies from clipboard.')
        } else {
          console.log('\n  Copy the Cookie header from nature.com (F12 → Network → Request Headers)')
          console.log('  Then run: subscope auth academic')
          console.log('  (reads from clipboard automatically)\n')
          return
        }
      }
      const auth = loadAuth()
      auth.academic = { cookies }
      saveAuth(auth)
      console.log('\n  Academic cookies saved. Press g on papers to download PDFs.\n')
      return
    }

    // service === 'x'
    let token = args[1]
    if (!token) {
      const clip = readClipboard()
      if (/^[a-f0-9]{30,}$/.test(clip)) {
        token = clip
        console.log('\n  Read auth_token from clipboard.')
      } else {
        console.log('\n  Copy auth_token from x.com (F12 → Application → Cookies → auth_token)')
        console.log('  Then run: subscope auth x')
        console.log('  (reads from clipboard automatically)\n')
        return
      }
    }
    const auth = loadAuth()
    auth.x = { auth_token: token }
    saveAuth(auth)
    console.log('\n  X auth token saved. Stale accounts will now use Playwright.\n')
  },

  read: async () => {
    const url = args[0]
    if (!url) { console.error('Usage: subscope read <url>'); process.exit(1) }
    try {
      const { title, text } = await readArticle(url)
      console.log(`# ${title}\n\n${text}`)
    } catch (e: any) {
      console.error(`Failed to read: ${e.message}`)
      process.exit(1)
    }
  },

  mode: async () => {
    const config = load()
    const target = args[0]

    if (!target) {
      console.log()
      for (const [name, m] of Object.entries(config.modes)) {
        const isDefault = name === config.defaultMode
        const icon = isDefault ? `\x1b[36m\u25cf\x1b[0m` : `\x1b[90m\u25cb\x1b[0m`
        const label = isDefault ? `\x1b[1m${name}\x1b[0m` : `\x1b[90m${name}\x1b[0m`
        const def = isDefault ? ` \x1b[2m(default)\x1b[0m` : ''
        const parts = [m.types?.join(', '), m.groups?.map(g => `[${g}]`).join(', ')].filter(Boolean).join(' ')
        console.log(`  ${icon} ${label}  \x1b[2m${parts}${def}\x1b[0m`)
      }
      console.log(`\n  \x1b[2msubscope mode <name>  set default\x1b[0m\n`)
      return
    }

    if (!config.modes[target]) {
      console.error(`Unknown mode: ${target}`)
      console.error(`Available: ${Object.keys(config.modes).join(', ')}`)
      process.exit(1)
    }

    config.defaultMode = target
    save(config)
    console.log(`\n  Default mode set to: ${target}\n`)
  },
}

// ── Route ──

const parseReadFlags = (argv: string[]) => {
  const opts: ReadOpts & { json?: boolean } = {}
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '-n' && argv[i + 1]) opts.limit = parseInt(argv[i + 1]!)
    if (argv[i] === '--type' && argv[i + 1]) opts.sourceType = argv[i + 1] as SourceType
    if (argv[i] === '--all' || argv[i] === '-a') opts.all = true
    if ((argv[i] === '-g' || argv[i] === '--group') && argv[i + 1]) opts.group = argv[i + 1]
    if (argv[i] === '-j' || argv[i] === '--json') {
      opts.json = true
      if (argv[i + 1] && /^\d+$/.test(argv[i + 1]!)) opts.limit = parseInt(argv[i + 1]!)
    }
  }
  return opts
}

const config = load()
const isMode = command && command in config.modes && !commands[command]

if (!command || command.startsWith('-') || isMode) {
  const readArgs = isMode ? args : process.argv.slice(2)
  const opts = parseReadFlags(readArgs)
  if (isMode) opts.mode = command
  const { items, olderCount } = read(opts)
  const cfg = load()

  if (opts.json) {
    const clean = (s: string) => s.replace(/<[^>]*>/g, '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim()
    const output = items.map(i => ({
      title: i.title,
      source: formatSourceName(i.sourceName),
      url: i.url,
      summary: i.summary ? clean(i.summary) : undefined,
      publishedAt: i.publishedAt,
    }))
    console.log(JSON.stringify(output))
  } else if (process.stdout.isTTY && opts.limit === undefined) {
    await renderInteractive(items, olderCount, cfg.sources.length > 0)
  } else {
    renderFeed(items, olderCount, cfg.sources.length > 0)
  }
} else if (commands[command]) {
  await commands[command]!()
} else {
  console.error(`Unknown command: ${command}`)
  console.error('Commands: add, ls, rm, fetch, group, on, off, mode')
  process.exit(1)
}
