import { load, save, type Config } from './config.ts'

// ── ANSI ──

const esc = (code: string) => `\x1b[${code}`
const RESET = esc('0m')
const BOLD = esc('1m')
const DIM = esc('2m')
const CYAN = esc('36m')
const GRAY = esc('90m')
const WHITE = esc('37m')
const YELLOW = esc('33m')
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
  kind: 'gap' | 'label' | 'mode' | 'folder' | 'source'
  key?: string
  text: string
  active?: boolean
  depth?: number
}

// Get children of a path: immediate subgroups + sources at this level
const childrenAt = (cfg: Config, path: string) => {
  const allGroups = [...new Set(cfg.sources.map(s => s.group))]
  const prefix = path ? path + '/' : ''

  // Find immediate child folders (next level only)
  const childFolders = new Set<string>()
  for (const g of allGroups) {
    if (!g.startsWith(prefix)) continue
    const rest = g.slice(prefix.length)
    const nextPart = rest.split('/')[0]!
    if (rest.includes('/')) {
      // This is a subfolder
      childFolders.add(nextPart)
    } else {
      // This is a direct child group
      childFolders.add(nextPart)
    }
  }

  // Find sources directly in this path
  const sources = cfg.sources.filter(s => s.group === path)

  return { folders: [...childFolders].sort(), sources }
}

const isFolderActive = (cfg: Config, path: string) =>
  cfg.activeGroups.some(g => g === path || g.startsWith(path + '/'))

const folderSourceCount = (cfg: Config, path: string) => {
  const prefix = path + '/'
  return cfg.sources.filter(s => s.group === path || s.group.startsWith(prefix))
}

const buildRows = (cfg: Config, path: string): Row[] => {
  const r: Row[] = []
  const { folders, sources } = childrenAt(cfg, path)

  if (path === '') {
    // Root: show modes first
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
  }

  for (const f of folders) {
    const fullPath = path ? `${path}/${f}` : f
    const all = folderSourceCount(cfg, fullPath)
    const on = all.filter(s => s.active).length
    const hasChildren = childrenAt(cfg, fullPath).folders.length > 0 || childrenAt(cfg, fullPath).sources.length > 0
    r.push({
      kind: 'folder',
      key: fullPath,
      text: `${f}  ${DIM}${on}/${all.length}${RESET}`,
      active: isFolderActive(cfg, fullPath),
    })
  }

  for (const s of sources) {
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

const render = (path: string, rowList: Row[], cursor: number, dirty: boolean, inputMode: string) => {
  const w = cols()
  const h = rows()
  const out: string[] = []

  const title = path || 'subscope config'
  const breadcrumb = path ? path.split('/').map(p => `${BOLD}${p}${RESET}`).join(` ${DIM}/${RESET} `) : ''
  out.push(`  ${breadcrumb || `${BOLD}${title}${RESET}`}`)
  out.push('')

  for (let i = 0; i < rowList.length; i++) {
    const row = rowList[i]!
    const sel = i === cursor

    if (row.kind === 'gap') { out.push(''); continue }
    if (row.kind === 'label') { out.push(`  ${DIM}${row.text}${RESET}`); continue }

    const icon = row.kind === 'folder'
      ? (row.active ? `${CYAN}\u25b8${RESET}` : `${GRAY}\u25b8${RESET}`)
      : (row.active ? `${CYAN}\u25cf${RESET}` : `${GRAY}\u25cb${RESET}`)

    const ptr = sel ? `${CYAN}\u203a${RESET}` : ' '
    const arrow = sel && row.kind === 'folder' ? `  ${DIM}\u2192${RESET}` : ''
    const label = sel ? `${BOLD}${row.text}${RESET}` : row.text
    const tag = row.kind === 'mode' && row.active ? `  ${DIM}(default)${RESET}` : ''

    out.push(` ${ptr} ${icon} ${label}${tag}${arrow}`)
  }

  // Input prompt
  if (inputMode) {
    out.push('')
    out.push(`  ${YELLOW}${inputMode}${RESET}`)
  }

  while (out.length < h - 2) out.push('')

  // Status bar
  const nav = path
    ? '\u2191\u2193 move  space toggle  \u2192 open  \u2190 back  n new folder  enter save'
    : '\u2191\u2193 move  space toggle  \u2192 open  n new folder  enter save  q quit'
  const mark = dirty ? `${CYAN}*${RESET} ` : '  '
  const pad = Math.max(0, w - nav.length - 4)
  out.push(`${BG_BAR}${WHITE} ${mark}${DIM}${nav}${' '.repeat(pad)}${RESET}`)

  process.stdout.write(HOME + HIDE_CURSOR + out.map(l => l + CLR_LINE).join('\n') + CLR_BELOW)
}

// ── Navigation ──

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
  } else if (row.kind === 'folder') {
    const path = row.key!
    // Toggle all leaf groups under this path
    const leafGroups = [...new Set(cfg.sources.map(s => s.group))]
      .filter(g => g === path || g.startsWith(path + '/'))
    const allActive = leafGroups.every(g => cfg.activeGroups.includes(g))
    if (allActive) {
      cfg.activeGroups = cfg.activeGroups.filter(g => g !== path && !g.startsWith(path + '/'))
    } else {
      for (const g of leafGroups) {
        if (!cfg.activeGroups.includes(g)) cfg.activeGroups.push(g)
      }
    }
  } else if (row.kind === 'source') {
    const src = cfg.sources.find(s => s.id === row.key)
    if (src) src.active = !src.active
  }
}

// ── Main loop ──

export const interactiveConfig = (): Promise<void> => {
  const cfg = load()

  // Navigation stack: [{ path, cursor }]
  const stack: { path: string; cursor: number }[] = [{ path: '', cursor: 0 }]

  let dirty = false
  let inputMode = '' // empty = normal, non-empty = typing folder name
  let inputBuffer = ''

  const current = () => stack[stack.length - 1]!

  let rowList = buildRows(cfg, current().path)
  current().cursor = findFirst(rowList)

  process.stdout.write(ALT_ON)

  const draw = () => {
    rowList = buildRows(cfg, current().path)
    render(current().path, rowList, current().cursor, dirty, inputMode ? `New folder: ${inputBuffer}\u2588` : '')
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
      // Input mode: typing folder name
      if (inputMode) {
        if (key === '\r') {
          // Create the folder (just set it as active — sources can be moved into it later)
          if (inputBuffer.trim()) {
            const newPath = current().path
              ? `${current().path}/${inputBuffer.trim()}`
              : inputBuffer.trim()
            if (!cfg.activeGroups.includes(newPath)) {
              cfg.activeGroups.push(newPath)
            }
            dirty = true
          }
          inputMode = ''
          inputBuffer = ''
          draw()
        } else if (key === '\x1b' || key === '\x03') {
          inputMode = ''
          inputBuffer = ''
          draw()
        } else if (key === '\x7f' || key === '\b') {
          inputBuffer = inputBuffer.slice(0, -1)
          draw()
        } else if (key.length === 1 && key.charCodeAt(0) >= 32) {
          inputBuffer += key
          draw()
        }
        return
      }

      // Normal mode
      if (key === '\x1b[A' || key === 'k') {
        current().cursor = findNext(rowList, current().cursor, -1)
        draw()
      } else if (key === '\x1b[B' || key === 'j') {
        current().cursor = findNext(rowList, current().cursor, 1)
        draw()
      } else if (key === ' ') {
        const row = rowList[current().cursor]
        if (row && selectable(row)) {
          toggle(cfg, row)
          dirty = true
          draw()
        }
      } else if (key === '\x1b[C' || key === 'l') {
        const row = rowList[current().cursor]
        if (row?.kind === 'folder') {
          stack.push({ path: row.key!, cursor: 0 })
          rowList = buildRows(cfg, current().path)
          current().cursor = findFirst(rowList)
          draw()
        }
      } else if (key === '\x1b[D' || key === 'h') {
        if (stack.length > 1) {
          stack.pop()
          draw()
        }
      } else if (key === 'n') {
        inputMode = 'new'
        inputBuffer = ''
        draw()
      } else if (key === '\r' || key === 'q' || key === '\x03') {
        quit()
      }
    }

    process.stdin.on('data', onKey)
  })
}
