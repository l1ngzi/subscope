#!/usr/bin/env bun

import { load, save, addSource, removeSource, inferGroup } from './config.ts'
import { createStore } from './store.ts'
import { fetchAll, read } from './pipeline.ts'
import { detectType } from './adapters/index.ts'
import { renderFeed, renderInteractive, renderSources, renderGroups } from './render.ts'
import { interactiveConfig } from './interactive.ts'
import { notify } from './notify.ts'
import { readArticle } from './reader.ts'

import { createHash } from 'crypto'
import type { Source } from './types.ts'

const [command, ...args] = process.argv.slice(2)

const commands: Record<string, () => Promise<void>> = {
  add: async () => {
    // Parse -g/--group flag
    let group: string | undefined
    const filteredArgs: string[] = []
    for (let i = 0; i < args.length; i++) {
      if ((args[i] === '-g' || args[i] === '--group') && args[i + 1]) {
        group = args[++i]!
      } else {
        filteredArgs.push(args[i]!)
      }
    }

    const url = filteredArgs[0]
    if (!url) {
      console.error('Usage: subscope add <url> [-g group]')
      process.exit(1)
    }

    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      console.error(`Invalid URL: ${url}`)
      process.exit(1)
    }

    const config = load()
    if (config.sources.some(s => s.url === parsed.href)) {
      console.log('Source already exists.')
      return
    }

    const type = detectType(parsed.href)
    const id = createHash('sha256').update(parsed.href).digest('hex').slice(0, 8)
    const host = parsed.hostname.replace('www.', '')
    const path = parsed.pathname.replace(/\/+$/, '')
    const name = path && path !== '/' ? `${host}${path}` : host

    const source: Source = {
      id,
      url: parsed.href,
      type,
      name,
      group: group ?? inferGroup(parsed.href),
      active: true,
      addedAt: new Date().toISOString(),
    }

    save(addSource(config, source))
    console.log(`\n  Added: ${name} → [${source.group}]\n`)
  },

  ls: async () => {
    const { sources } = load()
    renderSources(sources)
  },

  rm: async () => {
    const target = args[0]
    if (!target) {
      console.error('Usage: subscope rm <id|url>')
      process.exit(1)
    }

    const config = load()
    const source = config.sources.find(s => s.id === target || s.url === target)
    if (!source) {
      console.error('Source not found.')
      process.exit(1)
    }

    save(removeSource(config, source.id))
    const store = createStore()
    store.removeBySource(source.id)
    store.close()
    console.log(`\n  Removed: ${source.name}\n`)
  },

  fetch: async () => {
    const config = load()
    if (config.sources.length === 0) {
      console.log('\n  No sources to fetch. Add one with: subscope add <url>\n')
      return
    }

    const silent = args.includes('--notify')
    if (!silent) console.log('\n  Fetching...\n')
    const newItems = await fetchAll()
    if (silent) {
      if (newItems > 0) notify('subscope', `${newItems} new item${newItems > 1 ? 's' : ''}`)
    } else {
      console.log(`\n  Done. ${newItems} new items.\n`)
    }
  },

  watch: async () => {
    const minutes = parseInt(args[0] ?? '10')
    const ms = minutes * 60_000
    console.log(`\n  Watching every ${minutes}m. Ctrl+C to stop.\n`)

    const tick = async () => {
      const time = new Date().toLocaleTimeString()
      process.stdout.write(`  [${time}] Fetching... `)
      const newItems = await fetchAll().catch(() => 0)
      process.stdout.write(`${newItems} new\n`)
      if (newItems > 0) {
        notify('subscope', `${newItems} new item${newItems > 1 ? 's' : ''}`)
      }
    }

    await tick()
    setInterval(tick, ms)
    // Keep alive
    await new Promise(() => {})
  },

  'watch-install': async () => {
    const minutes = parseInt(args[0] ?? '10')
    const { join } = await import('path')
    const { homedir } = await import('os')

    const bun = join(homedir(), '.bun', 'bin', 'bun.exe').replace(/\//g, '\\')
    const cli = join(import.meta.dir, 'cli.ts').replace(/\//g, '\\')
    const action = `"${bun}" "${cli}" fetch --notify`

    // Create Windows Scheduled Task
    const ps = `
$action = New-ScheduledTaskAction -Execute "powershell" -Argument "-NoProfile -WindowStyle Hidden -Command & '${bun}' '${cli}' fetch --notify"
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes ${minutes}) -RepetitionDuration ([TimeSpan]::MaxValue)
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
Register-ScheduledTask -TaskName "subscope" -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
Write-Output "ok"
`
    const result = Bun.spawnSync(['powershell', '-NoProfile', '-Command', ps])
    const out = new TextDecoder().decode(result.stdout).trim()

    if (out === 'ok') {
      console.log(`\n  Installed. subscope will fetch every ${minutes}m in the background.`)
      console.log(`  New items trigger a Windows notification.`)
      console.log(`  Remove with: subscope watch-uninstall\n`)
    } else {
      console.error('\n  Failed to create scheduled task. Try running as administrator.\n')
    }
  },

  'watch-uninstall': async () => {
    const ps = `Unregister-ScheduledTask -TaskName "subscope" -Confirm:$false 2>$null; Write-Output "ok"`
    Bun.spawnSync(['powershell', '-NoProfile', '-Command', ps])
    console.log('\n  Scheduled task removed.\n')
  },

  group: async () => {
    const config = load()
    const sub = args[0]

    // subscope group — list all groups
    if (!sub) {
      renderGroups(config)
      return
    }

    const action = args[1]
    const allGroups = [...new Set(config.sources.map(s => s.group))]

    // subscope group <path> — show sources matching prefix
    if (!action) {
      const sources = config.sources.filter(s => s.group === sub || s.group.startsWith(sub + '/'))
      if (sources.length === 0) {
        console.log(`\n  Group "${sub}" not found or empty.\n`)
        return
      }
      renderSources(sources)
      return
    }

    // subscope group <path> on/off — supports prefix (e.g. "ai" activates all ai/*)
    if (action === 'on') {
      // Find all leaf groups matching this prefix
      const matching = allGroups.filter(g => g === sub || g.startsWith(sub + '/'))
      if (matching.length === 0) {
        console.log(`\n  No groups matching "${sub}".\n`)
        return
      }
      for (const g of matching) {
        if (!config.activeGroups.includes(g)) config.activeGroups.push(g)
      }
      save(config)
      console.log(`\n  Activated: ${matching.join(', ')}\n`)
      return
    }

    if (action === 'off') {
      const before = config.activeGroups.length
      config.activeGroups = config.activeGroups.filter(g => g !== sub && !g.startsWith(sub + '/'))
      save(config)
      const removed = before - config.activeGroups.length
      console.log(`\n  Deactivated ${removed} group${removed !== 1 ? 's' : ''} matching "${sub}".\n`)
      return
    }

    // subscope group <name> add <source-id>
    if (action === 'add' && args[2]) {
      const source = config.sources.find(s => s.id === args[2])
      if (!source) {
        console.error('Source not found.')
        process.exit(1)
      }
      source.group = sub
      if (!config.activeGroups.includes(sub)) {
        config.activeGroups.push(sub)
      }
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
    source.active = true
    save(config)
    console.log(`\n  Activated: ${source.name}\n`)
  },

  off: async () => {
    const target = args[0]
    if (!target) { console.error('Usage: subscope off <id>'); process.exit(1) }
    const config = load()
    const source = config.sources.find(s => s.id === target)
    if (!source) { console.error('Source not found.'); process.exit(1) }
    source.active = false
    save(config)
    console.log(`\n  Deactivated: ${source.name}\n`)
  },

  config: async () => {
    await interactiveConfig()
  },

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
        // Try reading from clipboard
        const clip = Bun.spawnSync(['powershell', '-NoProfile', '-Command', 'Get-Clipboard'], { stdout: 'pipe' })
        const clipText = new TextDecoder().decode(clip.stdout).replace(/[\r\n]+/g, ' ').trim()

        if (clipText && clipText.includes('=') && clipText.length > 20) {
          cookies = clipText
          console.log('\n  Read cookies from clipboard.')
        } else {
          console.log('\n  Copy the Cookie header from nature.com (F12 → Network → Request Headers)')
          console.log('  Then run: subscope auth academic')
          console.log('  (reads from clipboard automatically)\n')
          return
        }
      }

      const { join } = await import('path')
      const { homedir } = await import('os')
      const { readFileSync, writeFileSync, existsSync, mkdirSync } = await import('fs')
      const { parse: yamlParse, stringify: yamlStringify } = await import('yaml')

      const dir = join(homedir(), '.subscope')
      const authFile = join(dir, 'auth.yml')
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

      let auth: any = {}
      if (existsSync(authFile)) auth = yamlParse(readFileSync(authFile, 'utf-8')) ?? {}
      auth.academic = { cookies }
      writeFileSync(authFile, yamlStringify(auth))
      console.log('\n  Academic cookies saved. Press g on papers to download PDFs.\n')
      return
    }

    let token = args[1]
    if (!token) {
      const clip = Bun.spawnSync(['powershell', '-NoProfile', '-Command', 'Get-Clipboard'], { stdout: 'pipe' })
      const clipText = new TextDecoder().decode(clip.stdout).replace(/[\r\n]+/g, '').trim()

      if (clipText && /^[a-f0-9]{30,}$/.test(clipText)) {
        token = clipText
        console.log('\n  Read auth_token from clipboard.')
      } else {
        console.log('\n  Copy auth_token from x.com (F12 → Application → Cookies → auth_token)')
        console.log('  Then run: subscope auth x')
        console.log('  (reads from clipboard automatically)\n')
        return
      }
    }

    const { join } = await import('path')
    const { homedir } = await import('os')
    const { readFileSync, writeFileSync, existsSync, mkdirSync } = await import('fs')
    const { parse: yamlParse, stringify: yamlStringify } = await import('yaml')

    const dir = join(homedir(), '.subscope')
    const authFile = join(dir, 'auth.yml')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

    let auth: any = {}
    if (existsSync(authFile)) {
      auth = yamlParse(readFileSync(authFile, 'utf-8')) ?? {}
    }
    auth.x = { auth_token: token }
    writeFileSync(authFile, yamlStringify(auth))

    console.log('\n  X auth token saved. Stale accounts will now use Playwright.\n')
  },

  read: async () => {
    const url = args[0]
    if (!url) {
      console.error('Usage: subscope read <url>')
      process.exit(1)
    }
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
      // subscope mode — show all modes
      console.log()
      for (const [name, m] of Object.entries(config.modes)) {
        const isDefault = name === config.defaultMode
        const icon = isDefault ? `\x1b[36m\u25cf\x1b[0m` : `\x1b[90m\u25cb\x1b[0m`
        const label = isDefault ? `\x1b[1m${name}\x1b[0m` : `\x1b[90m${name}\x1b[0m`
        const def = isDefault ? ` \x1b[2m(default)\x1b[0m` : ''
        const parts = [m.types?.join(', '), m.groups?.map(g => `[${g}]`).join(', ')].filter(Boolean).join(' ')
        console.log(`  ${icon} ${label}  \x1b[2m${parts}${def}\x1b[0m`)
      }
      console.log(`\n  \x1b[2msubscope mode <name>  set default\x1b[0m`)
      console.log()
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

// --- route ---

const parseReadFlags = (argv: string[]) => {
  const opts: { limit?: number; sourceType?: string; all?: boolean; group?: string } = {}
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '-n' && argv[i + 1]) opts.limit = parseInt(argv[i + 1]!)
    if (argv[i] === '--type' && argv[i + 1]) opts.sourceType = argv[i + 1]
    if (argv[i] === '--all' || argv[i] === '-a') opts.all = true
    if ((argv[i] === '-g' || argv[i] === '--group') && argv[i + 1]) opts.group = argv[i + 1]
  }
  return opts
}

// Check if command is a mode name (e.g. "subscope quick", "subscope formal")
const config = load()
const isMode = command && command in config.modes && !commands[command]

if (!command || command.startsWith('-') || isMode) {
  const readArgs = isMode ? args : process.argv.slice(2)
  const opts = parseReadFlags(readArgs)
  if (isMode) opts.mode = command
  const { items, olderCount } = read(opts)
  const cfg = load()
  const hasSources = cfg.sources.length > 0

  const isTTY = process.stdout.isTTY
  const explicitLimit = opts.limit !== undefined

  if (isTTY && !explicitLimit) {
    await renderInteractive(items, olderCount, hasSources)
  } else {
    renderFeed(items, olderCount, hasSources)
  }
} else if (commands[command]) {
  await commands[command]!()
} else {
  console.error(`Unknown command: ${command}`)
  console.error('Commands: add, ls, rm, fetch, group, on, off, mode')
  process.exit(1)
}
