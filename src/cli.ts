#!/usr/bin/env bun

import { load, save, addSource, removeSource, inferGroup } from './config.ts'
import { createStore } from './store.ts'
import { fetchAll, read } from './pipeline.ts'
import { detectType } from './adapters/index.ts'
import { renderFeed, renderInteractive, renderSources, renderGroups } from './render.ts'
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

    console.log('\n  Fetching...\n')
    const total = await fetchAll()
    console.log(`\n  Done. ${total} items fetched.\n`)
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

    // subscope group <name> — show sources in group
    if (!action) {
      const sources = config.sources.filter(s => s.group === sub)
      if (sources.length === 0) {
        console.log(`\n  Group "${sub}" not found or empty.\n`)
        return
      }
      renderSources(sources)
      return
    }

    // subscope group <name> on/off
    if (action === 'on') {
      if (!config.activeGroups.includes(sub)) {
        config.activeGroups.push(sub)
      }
      save(config)
      console.log(`\n  Group "${sub}" activated.\n`)
      return
    }

    if (action === 'off') {
      config.activeGroups = config.activeGroups.filter(g => g !== sub)
      save(config)
      console.log(`\n  Group "${sub}" deactivated.\n`)
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

if (!command || command.startsWith('-')) {
  const opts = parseReadFlags(process.argv.slice(2))
  const { items, olderCount } = read(opts)

  const isTTY = process.stdout.isTTY
  const explicitLimit = opts.limit !== undefined

  if (isTTY && !explicitLimit) {
    await renderInteractive(items)
  } else {
    renderFeed(items, olderCount)
  }
} else if (commands[command]) {
  await commands[command]!()
} else {
  console.error(`Unknown command: ${command}`)
  console.error('Commands: add, ls, rm, fetch, group, on, off')
  process.exit(1)
}
