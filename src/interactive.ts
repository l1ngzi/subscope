import { load, save } from './config.ts'
import type { Config } from './config.ts'

const RESET = '\x1b[0m'
const BOLD = '\x1b[1m'
const DIM = '\x1b[2m'
const CYAN = '\x1b[36m'
const GRAY = '\x1b[90m'
const WHITE = '\x1b[37m'
const BG_GRAY = '\x1b[48;5;236m'
const INVERSE = '\x1b[7m'

type Item = {
  kind: 'header'
  label: string
} | {
  kind: 'mode'
  name: string
  types: string[]
} | {
  kind: 'group'
  name: string
  total: number
  active: number
} | {
  kind: 'source'
  id: string
  name: string
  type: string
  url: string
}

interface State {
  screen: 'main' | 'group'
  groupName?: string
  cursor: number
  config: Config
  dirty: boolean
}

const buildMainItems = (config: Config): Item[] => {
  const items: Item[] = []

  items.push({ kind: 'header', label: 'Default Mode' })
  for (const [name, m] of Object.entries(config.modes)) {
    items.push({ kind: 'mode', name, types: m.types })
  }

  items.push({ kind: 'header', label: 'Groups' })
  const groups = [...new Set(config.sources.map(s => s.group))]
  for (const g of groups) {
    const sources = config.sources.filter(s => s.group === g)
    const active = sources.filter(s => s.active).length
    items.push({ kind: 'group', name: g, total: sources.length, active })
  }

  return items
}

const buildGroupItems = (config: Config, group: string): Item[] => {
  const items: Item[] = []
  items.push({ kind: 'header', label: group })
  for (const s of config.sources.filter(s => s.group === group)) {
    items.push({ kind: 'source', id: s.id, name: s.name, type: s.type, url: s.url })
  }
  return items
}

const isSelectable = (item: Item) => item.kind !== 'header'

const nextSelectable = (items: Item[], from: number, dir: 1 | -1): number => {
  let i = from + dir
  while (i >= 0 && i < items.length) {
    if (isSelectable(items[i]!)) return i
    i += dir
  }
  return from
}

const firstSelectable = (items: Item[]): number => {
  for (let i = 0; i < items.length; i++) {
    if (isSelectable(items[i]!)) return i
  }
  return 0
}

const isActive = (state: State, item: Item): boolean => {
  if (item.kind === 'mode') return state.config.defaultMode === item.name
  if (item.kind === 'group') return state.config.activeGroups.includes(item.name)
  if (item.kind === 'source') {
    const source = state.config.sources.find(s => s.id === item.id)
    return source?.active ?? false
  }
  return false
}

const toggle = (state: State, item: Item): void => {
  state.dirty = true
  if (item.kind === 'mode') {
    state.config.defaultMode = item.name
  } else if (item.kind === 'group') {
    const idx = state.config.activeGroups.indexOf(item.name)
    if (idx >= 0) state.config.activeGroups.splice(idx, 1)
    else state.config.activeGroups.push(item.name)
  } else if (item.kind === 'source') {
    const source = state.config.sources.find(s => s.id === item.id)
    if (source) source.active = !source.active
  }
}

const cols = () => process.stdout.columns || 80
const rows = () => process.stdout.rows || 24

const renderLine = (item: Item, selected: boolean, active: boolean): string => {
  const cursor = selected ? `${CYAN}\u203a${RESET}` : ' '

  if (item.kind === 'header') {
    return `\n  ${DIM}${item.label}${RESET}`
  }

  const icon = active ? `${CYAN}\u25cf${RESET}` : `${GRAY}\u25cb${RESET}`

  if (item.kind === 'mode') {
    const label = selected ? `${BOLD}${item.name}${RESET}` : item.name
    const def = active ? ` ${DIM}(default)${RESET}` : ''
    return ` ${cursor} ${icon} ${label}  ${DIM}${item.types.join(', ')}${def}${RESET}`
  }

  if (item.kind === 'group') {
    const label = selected ? `${BOLD}${item.name}${RESET}` : item.name
    const arrow = selected ? ` ${DIM}\u2192${RESET}` : ''
    return ` ${cursor} ${icon} ${label}  ${DIM}${item.active}/${item.total} sources${arrow}${RESET}`
  }

  if (item.kind === 'source') {
    const label = selected ? `${BOLD}${item.name}${RESET}` : item.name
    return ` ${cursor} ${icon} ${label}  ${DIM}${item.type}${RESET}`
  }

  return ''
}

const CLR = '\x1b[K' // clear to end of line

const draw = (state: State, fullClear = false) => {
  const items = state.screen === 'main'
    ? buildMainItems(state.config)
    : buildGroupItems(state.config, state.groupName!)

  if (fullClear) {
    process.stdout.write('\x1b[2J') // only on first draw or screen switch
  }
  process.stdout.write('\x1b[H') // cursor home — overwrite in place
  process.stdout.write('\x1b[?25l') // hide cursor

  const title = state.screen === 'main' ? 'subscope config' : state.groupName!
  process.stdout.write(`${CLR}\n  ${BOLD}${title}${RESET}${CLR}\n`)

  for (let i = 0; i < items.length; i++) {
    const item = items[i]!
    const selected = i === state.cursor
    const active = isActive(state, item)
    process.stdout.write(renderLine(item, selected, active) + `${CLR}\n`)
  }

  // Clear remaining lines
  const used = items.length + 4
  const pad = Math.max(0, rows() - used)
  for (let i = 0; i < pad; i++) process.stdout.write(`${CLR}\n`)

  // Status bar
  const hints = state.screen === 'main'
    ? '\u2191\u2193 navigate  space toggle  \u2192 drill in  enter save  q quit'
    : '\u2191\u2193 navigate  space toggle  \u2190 back  enter save  q quit'
  const dirty = state.dirty ? ` ${CYAN}*${RESET}` : ''
  const bar = ` ${dirty} ${DIM}${hints}${RESET}`
  process.stdout.write(`${BG_GRAY}${WHITE}${bar}${''.padEnd(Math.max(0, cols() - hints.length - 4))}${RESET}${CLR}\n`)

  return items
}

export const interactiveConfig = (): Promise<void> => {
  const state: State = {
    screen: 'main',
    cursor: 0,
    config: load(),
    dirty: false,
  }

  // Enter alternate screen buffer — clean canvas, original terminal restored on exit
  process.stdout.write('\x1b[?1049h')

  let items = draw(state, true)
  state.cursor = firstSelectable(items)
  items = draw(state)

  return new Promise<void>(resolve => {
    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.setEncoding('utf-8')

    const cleanup = (doSave: boolean) => {
      if (doSave && state.dirty) {
        save(state.config)
      }
      process.stdout.write('\x1b[?25h') // show cursor
      process.stdout.write('\x1b[?1049l') // leave alternate screen — restores original terminal
      process.stdin.setRawMode(false)
      process.stdin.pause()
      process.stdin.removeListener('data', onKey)
      if (doSave && state.dirty) {
        console.log('\n  Config saved.\n')
      }
      resolve()
    }

    const onKey = (key: string) => {
      // Up
      if (key === '\x1b[A' || key === 'k') {
        state.cursor = nextSelectable(items, state.cursor, -1)
        items = draw(state)
      }
      // Down
      else if (key === '\x1b[B' || key === 'j') {
        state.cursor = nextSelectable(items, state.cursor, 1)
        items = draw(state)
      }
      // Space — toggle
      else if (key === ' ') {
        const item = items[state.cursor]
        if (item && isSelectable(item)) {
          toggle(state, item)
          items = draw(state)
        }
      }
      // Right / l — drill into group
      else if (key === '\x1b[C' || key === 'l') {
        const item = items[state.cursor]
        if (item?.kind === 'group') {
          state.screen = 'group'
          state.groupName = item.name
          items = draw(state, true)
          state.cursor = firstSelectable(items)
          items = draw(state)
        }
      }
      // Left / h — back to main
      else if (key === '\x1b[D' || key === 'h') {
        if (state.screen === 'group') {
          state.screen = 'main'
          items = draw(state, true)
          state.cursor = firstSelectable(items)
          items = draw(state)
        }
      }
      // Enter — save and exit
      else if (key === '\r') {
        cleanup(true)
      }
      // q / ESC / Ctrl+C — exit (save if dirty)
      else if (key === 'q' || key === '\x1b' || key === '\x03') {
        cleanup(true)
      }
    }

    process.stdin.on('data', onKey)
  })
}
