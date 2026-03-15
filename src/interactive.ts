import { load, save, addSource, type Config } from './config.ts'
import { createHash } from 'crypto'
import type { Source, SourceType } from './types.ts'

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
  const prefix = path ? path + '/' : ''

  const childFolders = new Set<string>()
  for (const f of cfg.folders) {
    if (!f.startsWith(prefix)) continue
    const rest = f.slice(prefix.length)
    if (!rest || rest.includes('/')) continue // only immediate children
    childFolders.add(rest)
  }

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
    ? '\u2191\u2193 move  space toggle  \u2192 open  \u2190 back  s sources  n new  e rename  d del  q save'
    : '\u2191\u2193 move  space toggle  \u2192 open  s sources  n new  e rename  d del  q save'
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
    const isActive = isFolderActive(cfg, path)

    // Collect ALL paths under this folder (from folders list + source groups)
    const allPaths = new Set<string>()
    for (const f of cfg.folders) {
      if (f === path || f.startsWith(path + '/')) allPaths.add(f)
    }
    for (const s of cfg.sources) {
      if (s.group === path || s.group.startsWith(path + '/')) allPaths.add(s.group)
    }

    if (isActive) {
      // Turn off: remove all matching from activeGroups
      cfg.activeGroups = cfg.activeGroups.filter(g => !allPaths.has(g))
    } else {
      // Turn on: add all matching to activeGroups
      for (const p of allPaths) {
        if (!cfg.activeGroups.includes(p)) cfg.activeGroups.push(p)
      }
    }
  } else if (row.kind === 'source') {
    const src = cfg.sources.find(s => s.id === row.key)
    if (src) src.active = !src.active
  }
}

// ── Source catalog ──

interface CatalogEntry {
  label: string
  type: SourceType
  url?: string           // fixed URL (pre-defined source)
  template?: string      // URL template with {handle} placeholder
  placeholder?: string   // input hint
}

const CATALOG: CatalogEntry[] = [
  // Pre-defined sources
  { label: 'Anthropic Blog', type: 'website', url: 'https://www.anthropic.com/blog' },
  { label: 'Anthropic Research', type: 'website', url: 'https://www.anthropic.com/research' },
  { label: 'Anthropic Engineering', type: 'website', url: 'https://www.anthropic.com/engineering' },
  { label: 'Claude Blog', type: 'website', url: 'https://www.claude.com/blog' },
  { label: 'Claude Release Notes', type: 'website', url: 'https://support.claude.com/en/articles/12138966-release-notes' },
  { label: 'Claude Usage & Limits', type: 'website', url: 'https://support.claude.com/en/collections/18031876-usage-and-limits' },
  { label: 'OpenAI News', type: 'website', url: 'https://openai.com/news/rss.xml' },
  { label: 'DeepMind Blog', type: 'website', url: 'https://deepmind.google/blog/rss.xml' },
  { label: 'DeepSeek Changelog', type: 'website', url: 'https://api-docs.deepseek.com/updates' },
  { label: 'xAI News', type: 'website', url: 'https://x.ai/news' },
  // Templates
  { label: 'YouTube Channel', type: 'youtube', template: 'https://www.youtube.com/@{handle}', placeholder: '@handle' },
  { label: 'X / Twitter Account', type: 'twitter', template: 'https://x.com/{handle}', placeholder: '@handle' },
  { label: 'GitHub Org / Repo', type: 'website', template: 'https://github.com/{handle}', placeholder: 'org or org/repo' },
  { label: 'Custom RSS / Website', type: 'website', template: '{handle}', placeholder: 'https://...' },
]

const makeSource = (entry: CatalogEntry, url: string, group: string): Source => {
  const parsed = new URL(url)
  const host = parsed.hostname.replace('www.', '')
  const path = parsed.pathname.replace(/\/+$/, '')
  const name = path && path !== '/' ? `${host}${path}` : host
  return {
    id: createHash('sha256').update(url).digest('hex').slice(0, 8),
    url,
    type: entry.type,
    name,
    group,
    active: true,
    addedAt: new Date().toISOString(),
  }
}

// ── Main loop ──

export const interactiveConfig = (): Promise<void> => {
  const cfg = load()

  // Navigation stack: [{ path, cursor }]
  const stack: { path: string; cursor: number }[] = [{ path: '', cursor: 0 }]

  let dirty = false
  let inputMode = '' // '', 'new', 'rename', 'add-search', 'add-handle'
  let inputBuffer = ''
  let addCatalog: CatalogEntry[] = []
  let addCursor = 0
  let addSelected: CatalogEntry | null = null
  let srcList: Source[] = []           // sources in current folder
  let srcCursor = 0
  let editSourceId = ''

  const getSrcList = () => {
    const path = current().path
    if (!path) return cfg.sources // root = all sources
    return cfg.sources.filter(s => s.group === path || s.group.startsWith(path + '/'))
  }

  const current = () => stack[stack.length - 1]!

  let rowList = buildRows(cfg, current().path)
  current().cursor = findFirst(rowList)

  process.stdout.write(ALT_ON)

  const draw = () => {
    if (inputMode === 'add-search' || inputMode === 'add-handle') { drawAddMode(); return }
    if (inputMode === 'sources' || inputMode === 'edit-source') { drawSourceMode(); return }
    rowList = buildRows(cfg, current().path)
    const prompt = inputMode === 'rename' ? `Rename: ${inputBuffer}\u2588`
      : inputMode === 'new' ? `New folder: ${inputBuffer}\u2588`
      : ''
    render(current().path, rowList, current().cursor, dirty, prompt)
  }

  const drawSourceMode = () => {
    const w = cols()
    const h = rows()
    const out: string[] = []

    const path = current().path || '(root)'
    out.push(`  ${BOLD}Sources in ${path}${RESET}`)
    out.push('')

    if (inputMode === 'edit-source') {
      out.push(`  ${DIM}Name:${RESET} ${YELLOW}${inputBuffer}\u2588${RESET}`)
      out.push('')
    }

    srcList = getSrcList()
    if (srcList.length === 0) {
      out.push(`  ${DIM}No sources. Press 'a' to add.${RESET}`)
    }
    for (let i = 0; i < srcList.length; i++) {
      const s = srcList[i]!
      const sel = i === srcCursor && inputMode !== 'edit-source'
      const ptr = sel ? `${CYAN}\u203a${RESET}` : ' '
      const icon = s.active ? `${CYAN}\u25cf${RESET}` : `${GRAY}\u25cb${RESET}`
      const label = sel ? `${BOLD}${s.name}${RESET}` : s.name
      out.push(` ${ptr} ${icon} ${label}  ${DIM}${s.type}${RESET}`)
      out.push(`       ${DIM}${s.url}${RESET}`)
    }

    while (out.length < h - 2) out.push('')
    const nav = inputMode === 'edit-source'
      ? 'enter confirm  esc cancel'
      : '\u2191\u2193 move  space toggle  a add  e edit  d delete  esc back'
    const mark = dirty ? `${CYAN}*${RESET} ` : '  '
    const pad = Math.max(0, w - nav.length - 4)
    out.push(`${BG_BAR}${WHITE} ${mark}${DIM}${nav}${' '.repeat(pad)}${RESET}`)
    process.stdout.write(HOME + HIDE_CURSOR + out.map(l => l + CLR_LINE).join('\n') + CLR_BELOW)
  }

  const drawAddMode = () => {
    const w = cols()
    const h = rows()
    const out: string[] = []

    if (inputMode === 'add-handle') {
      out.push(`  ${BOLD}Add: ${addSelected!.label}${RESET}`)
      out.push('')
      out.push(`  ${DIM}${addSelected!.placeholder}:${RESET} ${YELLOW}${inputBuffer}\u2588${RESET}`)
    } else {
      out.push(`  ${BOLD}Add source${RESET}  ${DIM}(type to search)${RESET}`)
      out.push(`  ${DIM}Search:${RESET} ${YELLOW}${inputBuffer}\u2588${RESET}`)
      out.push('')

      // Filter catalog: exclude already-added fixed sources
      const existingUrls = new Set(cfg.sources.map(s => s.url))
      addCatalog = CATALOG.filter(e => {
        if (e.url && existingUrls.has(e.url)) return false
        if (!inputBuffer) return true
        return e.label.toLowerCase().includes(inputBuffer.toLowerCase())
      })

      if (addCursor >= addCatalog.length) addCursor = Math.max(0, addCatalog.length - 1)

      for (let i = 0; i < addCatalog.length; i++) {
        const e = addCatalog[i]!
        const sel = i === addCursor
        const ptr = sel ? `${CYAN}\u203a${RESET}` : ' '
        const icon = e.template ? `${DIM}\u2026${RESET}` : `${CYAN}+${RESET}`
        const label = sel ? `${BOLD}${e.label}${RESET}` : e.label
        const hint = e.template ? `  ${DIM}${e.placeholder}${RESET}` : `  ${DIM}${e.url?.replace('https://', '')}${RESET}`
        out.push(` ${ptr} ${icon} ${label}${hint}`)
      }

      if (addCatalog.length === 0) {
        out.push(`  ${DIM}No matching sources${RESET}`)
      }
    }

    while (out.length < h - 2) out.push('')
    const nav = '\u2191\u2193 select  enter confirm  esc cancel'
    const pad = Math.max(0, w - nav.length - 4)
    out.push(`${BG_BAR}${WHITE}   ${DIM}${nav}${' '.repeat(pad)}${RESET}`)
    process.stdout.write(HOME + HIDE_CURSOR + out.map(l => l + CLR_LINE).join('\n') + CLR_BELOW)
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

    let returnToSources = false

    const exitInput = () => {
      const backToSources = returnToSources
      inputMode = backToSources ? 'sources' : ''
      inputBuffer = ''
      addSelected = null
      addCursor = 0
      returnToSources = false
      if (backToSources) srcList = getSrcList()
      draw()
    }

    const onKey = (key: string) => {
      // ── Add source: search mode ──
      if (inputMode === 'add-search') {
        if (key === '\x1b[A') { addCursor = Math.max(0, addCursor - 1); draw(); return }
        if (key === '\x1b[B') { addCursor = Math.min(addCatalog.length - 1, addCursor + 1); draw(); return }
        if (key === '\x03') { exitInput(); return }
        if (key === '\r') {
          const entry = addCatalog[addCursor]
          if (!entry) return
          if (entry.url) {
            // Fixed source — add directly
            const group = current().path || 'ungrouped'
            const src = makeSource(entry, entry.url, group)
            if (!cfg.sources.some(s => s.url === src.url)) {
              cfg.sources.push(src)
              if (!cfg.activeGroups.includes(group)) cfg.activeGroups.push(group)
              dirty = true
            }
            exitInput()
          } else {
            // Template — need handle input
            addSelected = entry
            inputMode = 'add-handle'
            inputBuffer = ''
            draw()
          }
          return
        }
        if (key === '\x7f' || key === '\b') { inputBuffer = inputBuffer.slice(0, -1); addCursor = 0; draw(); return }
        if (key.length === 1 && key.charCodeAt(0) >= 32) { inputBuffer += key; addCursor = 0; draw(); return }
        return
      }

      // ── Add source: handle input mode ──
      if (inputMode === 'add-handle') {
        if (key === '\x1b' || key === '\x03') { exitInput(); return }
        if (key === '\r') {
          if (inputBuffer.trim() && addSelected) {
            const handle = inputBuffer.trim().replace(/^@/, '')
            const url = addSelected.template!.replace('{handle}', handle)
            const group = current().path || 'ungrouped'
            const src = makeSource(addSelected, url, group)
            if (!cfg.sources.some(s => s.url === src.url)) {
              cfg.sources.push(src)
              if (!cfg.activeGroups.includes(group)) cfg.activeGroups.push(group)
              dirty = true
            }
          }
          exitInput()
          return
        }
        if (key === '\x7f' || key === '\b') { inputBuffer = inputBuffer.slice(0, -1); draw(); return }
        if (key.length === 1 && key.charCodeAt(0) >= 32) { inputBuffer += key; draw(); return }
        return
      }

      // ── Source edit mode (s) ──
      if (inputMode === 'sources') {
        if (key === '\x1b[A' || key === 'k') { srcCursor = Math.max(0, srcCursor - 1); draw(); return }
        if (key === '\x1b[B' || key === 'j') { srcCursor = Math.min(srcList.length - 1, srcCursor + 1); draw(); return }
        if (key === ' ') { const src = srcList[srcCursor]; if (src) { src.active = !src.active; dirty = true; draw() }; return }
        if (key === 'a') { returnToSources = true; inputMode = 'add-search'; inputBuffer = ''; addCursor = 0; draw(); return }
        if (key === 'e') { const src = srcList[srcCursor]; if (src) { inputMode = 'edit-source'; inputBuffer = src.name; editSourceId = src.id; draw() }; return }
        if (key === 'd') { const src = srcList[srcCursor]; if (src) { cfg.sources = cfg.sources.filter(s => s.id !== src.id); dirty = true; srcList = getSrcList(); srcCursor = Math.min(srcCursor, Math.max(0, srcList.length - 1)); draw() }; return }
        // q/enter/ctrl-c to exit — NOT bare \x1b (conflicts with arrow key prefix)
        if (key === '\r' || key === 'q' || key === '\x03') { inputMode = ''; draw(); return }
        return
      }

      // ── Edit source name ──
      if (inputMode === 'edit-source') {
        if (key === '\r') {
          if (inputBuffer.trim() && editSourceId) {
            const src = cfg.sources.find(s => s.id === editSourceId)
            if (src) { src.name = inputBuffer.trim(); dirty = true }
          }
          inputMode = 'sources'; inputBuffer = ''; editSourceId = ''; draw(); return
        }
        if (key === '\x1b' || key === '\x03') { inputMode = 'sources'; inputBuffer = ''; draw(); return }
        if (key === '\x7f' || key === '\b') { inputBuffer = inputBuffer.slice(0, -1); draw(); return }
        if (key.length === 1 && key.charCodeAt(0) >= 32) { inputBuffer += key; draw(); return }
        return
      }

      // ── Folder/rename input mode ──
      if (inputMode === 'new' || inputMode === 'rename') {
        if (key === '\r') {
          if (inputBuffer.trim()) {
            const newName = inputBuffer.trim()
            const newPath = current().path ? `${current().path}/${newName}` : newName

            if (inputMode === 'rename') {
              const row = rowList[current().cursor]
              const oldPath = row?.key!
              const rename = (p: string) =>
                p === oldPath ? newPath : p.startsWith(oldPath + '/') ? newPath + p.slice(oldPath.length) : p
              cfg.folders = cfg.folders.map(rename)
              cfg.activeGroups = cfg.activeGroups.map(rename)
              cfg.sources.forEach(s => { s.group = rename(s.group) })
            } else {
              if (!cfg.folders.includes(newPath)) cfg.folders.push(newPath)
              if (!cfg.activeGroups.includes(newPath)) cfg.activeGroups.push(newPath)
            }
            dirty = true
          }
          exitInput()
          return
        }
        if (key === '\x1b' || key === '\x03') { exitInput(); return }
        if (key === '\x7f' || key === '\b') { inputBuffer = inputBuffer.slice(0, -1); draw(); return }
        if (key.length === 1 && key.charCodeAt(0) >= 32) { inputBuffer += key; draw(); return }
        return
      }

      // ── Normal folder mode ──
      if (key === '\x1b[A' || key === 'k') {
        current().cursor = findNext(rowList, current().cursor, -1); draw()
      } else if (key === '\x1b[B' || key === 'j') {
        current().cursor = findNext(rowList, current().cursor, 1); draw()
      } else if (key === ' ') {
        const row = rowList[current().cursor]
        if (row && selectable(row)) { toggle(cfg, row); dirty = true; draw() }
      } else if (key === '\x1b[C' || key === 'l') {
        const row = rowList[current().cursor]
        if (row?.kind === 'folder') {
          stack.push({ path: row.key!, cursor: 0 })
          rowList = buildRows(cfg, current().path)
          current().cursor = findFirst(rowList)
          draw()
        }
      } else if (key === '\x1b[D' || key === 'h') {
        if (stack.length > 1) { stack.pop(); draw() }
      } else if (key === 's') {
        inputMode = 'sources'
        srcList = getSrcList()
        srcCursor = 0
        draw()
      } else if (key === 'n') {
        inputMode = 'new'; inputBuffer = ''; draw()
      } else if (key === 'e') {
        const row = rowList[current().cursor]
        if (row?.kind === 'folder') { inputMode = 'rename'; inputBuffer = row.key!.split('/').pop()!; draw() }
      } else if (key === 'd') {
        const row = rowList[current().cursor]
        if (row?.kind === 'folder') {
          const path = row.key!
          if (!cfg.sources.some(s => s.group === path || s.group.startsWith(path + '/'))) {
            cfg.folders = cfg.folders.filter(f => f !== path && !f.startsWith(path + '/'))
            cfg.activeGroups = cfg.activeGroups.filter(g => g !== path && !g.startsWith(path + '/'))
            dirty = true
            rowList = buildRows(cfg, current().path)
            current().cursor = Math.min(current().cursor, Math.max(0, rowList.length - 1))
            draw()
          }
        }
      } else if (key === '\r' || key === 'q' || key === '\x03') {
        quit()
      }
    }

    process.stdin.on('data', onKey)
  })
}
