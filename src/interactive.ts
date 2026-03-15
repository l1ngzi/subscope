import { load, save, type Config } from './config.ts'

// ── ANSI ──

const esc = (code: string) => `\x1b[${code}`
const RESET = esc('0m')
const BOLD = esc('1m')
const DIM = esc('2m')
const CYAN = esc('36m')
const GRAY = esc('90m')
const WHITE = esc('37m')
const BG_BAR = esc('48;5;236m')
const HIDE_CURSOR = esc('?25l')
const SHOW_CURSOR = esc('?25h')
const ALT_ON = esc('?1049h')
const ALT_OFF = esc('?1049l')
const HOME = esc('H')
const CLR_LINE = esc('K')
const CLR_BELOW = esc('J')

const cols = () => process.stdout.columns || 80
const rows = () => process.stdout.rows || 24

// ── Data ──

interface Row {
  kind: 'gap' | 'label' | 'mode' | 'group' | 'source'
  key?: string
  text: string
  active?: boolean
}

const mainRows = (cfg: Config): Row[] => {
  const r: Row[] = []
  r.push({ kind: 'label', text: 'Default Mode' })
  for (const [name, m] of Object.entries(cfg.modes)) {
    r.push({
      kind: 'mode',
      key: name,
      text: `${name}  ${DIM}${m.types.join(', ')}${RESET}`,
      active: cfg.defaultMode === name,
    })
  }
  r.push({ kind: 'gap', text: '' })
  r.push({ kind: 'label', text: 'Groups' })
  for (const g of [...new Set(cfg.sources.map(s => s.group))]) {
    const all = cfg.sources.filter(s => s.group === g)
    const on = all.filter(s => s.active).length
    r.push({
      kind: 'group',
      key: g,
      text: `${g}  ${DIM}${on}/${all.length} sources${RESET}`,
      active: cfg.activeGroups.includes(g),
    })
  }
  return r
}

const groupRows = (cfg: Config, group: string): Row[] => {
  const r: Row[] = []
  r.push({ kind: 'label', text: group })
  for (const s of cfg.sources.filter(s => s.group === group)) {
    r.push({
      kind: 'source',
      key: s.id,
      text: `${s.name}  ${DIM}${s.type}${RESET}`,
      active: s.active,
    })
  }
  return r
}

const selectable = (row: Row) => row.kind !== 'gap' && row.kind !== 'label'

// ── Render ──

const render = (title: string, rowList: Row[], cursor: number, dirty: boolean, isGroup: boolean) => {
  const w = cols()
  const h = rows()
  const out: string[] = []

  out.push(`  ${BOLD}${title}${RESET}`)
  out.push('')

  for (let i = 0; i < rowList.length; i++) {
    const row = rowList[i]!
    const sel = i === cursor

    if (row.kind === 'gap') {
      out.push('')
      continue
    }
    if (row.kind === 'label') {
      out.push(`  ${DIM}${row.text}${RESET}`)
      continue
    }

    const icon = row.active ? `${CYAN}\u25cf${RESET}` : `${GRAY}\u25cb${RESET}`
    const ptr = sel ? `${CYAN}\u203a${RESET}` : ' '
    const arrow = sel && row.kind === 'group' ? `  ${DIM}\u2192${RESET}` : ''
    const label = sel ? `${BOLD}${row.text}${RESET}` : row.text
    const tag = row.kind === 'mode' && row.active ? `  ${DIM}(default)${RESET}` : ''

    out.push(` ${ptr} ${icon} ${label}${tag}${arrow}`)
  }

  // Fill to push bar to bottom
  while (out.length < h - 2) out.push('')

  // Status bar
  const nav = isGroup
    ? '\u2191\u2193 navigate  space toggle  \u2190 back  enter save  q quit'
    : '\u2191\u2193 navigate  space toggle  \u2192 drill in  enter save  q quit'
  const mark = dirty ? `${CYAN}*${RESET} ` : '  '
  const pad = Math.max(0, w - nav.length - 4)
  out.push(`${BG_BAR}${WHITE} ${mark}${DIM}${nav}${' '.repeat(pad)}${RESET}`)

  // Single write: home + each line cleared to EOL + clear everything below
  process.stdout.write(
    HOME + HIDE_CURSOR + out.map(l => l + CLR_LINE).join('\n') + CLR_BELOW
  )
}

// ── Navigation helpers ──

const findNext = (rowList: Row[], from: number, dir: 1 | -1): number => {
  let i = from + dir
  while (i >= 0 && i < rowList.length) {
    if (selectable(rowList[i]!)) return i
    i += dir
  }
  return from
}

const findFirst = (rowList: Row[]): number => {
  for (let i = 0; i < rowList.length; i++) {
    if (selectable(rowList[i]!)) return i
  }
  return 0
}

// ── Toggle ──

const toggle = (cfg: Config, row: Row) => {
  if (row.kind === 'mode') {
    cfg.defaultMode = row.key!
  } else if (row.kind === 'group') {
    const i = cfg.activeGroups.indexOf(row.key!)
    if (i >= 0) cfg.activeGroups.splice(i, 1)
    else cfg.activeGroups.push(row.key!)
  } else if (row.kind === 'source') {
    const src = cfg.sources.find(s => s.id === row.key)
    if (src) src.active = !src.active
  }
}

// ── Main loop ──

export const interactiveConfig = (): Promise<void> => {
  const cfg = load()

  let screen: 'main' | 'group' = 'main'
  let groupName = ''
  let dirty = false
  let mainCursor = 0

  let rowList = mainRows(cfg)
  let cursor = findFirst(rowList)

  process.stdout.write(ALT_ON)

  const draw = () => {
    const title = screen === 'main' ? 'subscope config' : groupName
    render(title, rowList, cursor, dirty, screen === 'group')
  }

  draw()

  return new Promise<void>(resolve => {
    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.setEncoding('utf-8')

    const quit = () => {
      if (dirty) save(cfg)
      process.stdout.write(SHOW_CURSOR + ALT_OFF)
      process.stdin.setRawMode(false)
      process.stdin.pause()
      process.stdin.removeListener('data', onKey)
      if (dirty) console.log('\n  Config saved.\n')
      resolve()
    }

    const onKey = (key: string) => {
      if (key === '\x1b[A' || key === 'k') {
        cursor = findNext(rowList, cursor, -1)
        draw()
      } else if (key === '\x1b[B' || key === 'j') {
        cursor = findNext(rowList, cursor, 1)
        draw()
      } else if (key === ' ') {
        const row = rowList[cursor]
        if (row && selectable(row)) {
          toggle(cfg, row)
          dirty = true
          rowList = screen === 'main' ? mainRows(cfg) : groupRows(cfg, groupName)
          draw()
        }
      } else if (key === '\x1b[C' || key === 'l') {
        const row = rowList[cursor]
        if (row?.kind === 'group') {
          mainCursor = cursor
          screen = 'group'
          groupName = row.key!
          rowList = groupRows(cfg, groupName)
          cursor = findFirst(rowList)
          draw()
        }
      } else if (key === '\x1b[D' || key === 'h') {
        if (screen === 'group') {
          screen = 'main'
          rowList = mainRows(cfg)
          cursor = mainCursor
          draw()
        }
      } else if (key === '\r' || key === 'q' || key === '\x1b' || key === '\x03') {
        quit()
      }
    }

    process.stdin.on('data', onKey)
  })
}
