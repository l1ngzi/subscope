import { load, save, type Config } from './config.ts'
import { createHash } from 'crypto'
import type { Source, SourceType } from './types.ts'

// ── ANSI ──

const R = '\x1b[0m'
const B = '\x1b[1m'
const D = '\x1b[2m'
const C = '\x1b[36m'
const G = '\x1b[90m'
const Y = '\x1b[33m'
const W = '\x1b[37m'
const BAR = '\x1b[48;5;236m'

const w = () => process.stdout.columns || 80
const h = () => process.stdout.rows || 24

// ── Source catalog ──

interface CatalogEntry {
  label: string; type: SourceType; url?: string; template?: string; placeholder?: string
}

const CATALOG: CatalogEntry[] = [
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
  { label: 'YouTube Channel', type: 'youtube', template: 'https://www.youtube.com/@{handle}', placeholder: 'handle (e.g. anthropic-ai)' },
  { label: 'X / Twitter Account', type: 'twitter', template: 'https://x.com/{handle}', placeholder: 'handle (e.g. AnthropicAI)' },
  { label: 'GitHub Org / Repo', type: 'website', template: 'https://github.com/{handle}', placeholder: 'org or org/repo' },
  { label: 'Custom RSS / Website', type: 'website', template: '{handle}', placeholder: 'full URL' },
]

// ── State machine ──

type Mode =
  | { kind: 'folders' }
  | { kind: 'sources'; cursor: number }
  | { kind: 'text'; purpose: 'new-folder' | 'rename-folder' | 'add-handle'; buf: string; meta?: any }
  | { kind: 'catalog'; search: string; cursor: number }

export const interactiveConfig = (): Promise<void> => {
  const cfg = load()
  const nav: { path: string; cursor: number }[] = [{ path: '', cursor: 0 }]
  let mode: Mode = { kind: 'folders' }
  let dirty = false

  const cur = () => nav[nav.length - 1]!

  // ── Data helpers ──

  const allFolders = () => {
    const set = new Set<string>()
    for (const f of cfg.folders) set.add(f)
    for (const s of cfg.sources) set.add(s.group)
    for (const g of cfg.activeGroups) set.add(g)
    // Add parent paths
    for (const p of [...set]) {
      const parts = p.split('/')
      for (let i = 1; i < parts.length; i++) set.add(parts.slice(0, i).join('/'))
    }
    return set
  }

  const childFolders = (path: string) => {
    const prefix = path ? path + '/' : ''
    const children = new Set<string>()
    for (const f of allFolders()) {
      if (!f.startsWith(prefix)) continue
      const rest = f.slice(prefix.length)
      if (!rest || rest.includes('/')) continue
      children.add(rest)
    }
    return [...children].sort()
  }

  const sourcesIn = (path: string): Source[] => {
    if (!path) return cfg.sources
    return cfg.sources.filter(s => s.group === path || s.group.startsWith(path + '/'))
  }

  const isActive = (path: string) =>
    cfg.activeGroups.some(g => g === path || g.startsWith(path + '/'))

  const sourceCount = (path: string) => {
    const prefix = path + '/'
    return cfg.sources.filter(s => s.group === path || s.group.startsWith(prefix))
  }

  // ── Folder rows ──

  type Row = { kind: 'label' | 'gap' | 'mode' | 'folder'; key?: string; text: string; active?: boolean }

  const folderRows = (): Row[] => {
    const r: Row[] = []
    const path = cur().path
    if (!path) {
      r.push({ kind: 'label', text: 'Default Mode' })
      for (const [name, m] of Object.entries(cfg.modes))
        r.push({ kind: 'mode', key: name, text: `${name}  ${D}${m.types.join(', ')}${R}`, active: cfg.defaultMode === name })
      r.push({ kind: 'gap', text: '' })
      r.push({ kind: 'label', text: 'Groups' })
    }
    for (const f of childFolders(path)) {
      const full = path ? `${path}/${f}` : f
      const all = sourceCount(full)
      const on = all.filter(s => s.active).length
      r.push({ kind: 'folder', key: full, text: `${f}  ${D}${on}/${all.length}${R}`, active: isActive(full) })
    }
    return r
  }

  const selectable = (r: Row) => r.kind === 'mode' || r.kind === 'folder'
  const findSel = (rows: Row[], from: number, dir: 1 | -1) => {
    let i = from + dir
    while (i >= 0 && i < rows.length) { if (selectable(rows[i]!)) return i; i += dir }
    return from
  }
  const firstSel = (rows: Row[]) => { for (let i = 0; i < rows.length; i++) if (selectable(rows[i]!)) return i; return 0 }

  // ── Toggle ──

  const toggleFolder = (path: string) => {
    const paths = new Set<string>()
    for (const f of allFolders()) if (f === path || f.startsWith(path + '/')) paths.add(f)
    for (const s of cfg.sources) if (s.group === path || s.group.startsWith(path + '/')) paths.add(s.group)
    if (isActive(path)) {
      cfg.activeGroups = cfg.activeGroups.filter(g => !paths.has(g))
    } else {
      for (const p of paths) if (!cfg.activeGroups.includes(p)) cfg.activeGroups.push(p)
    }
  }

  // ── Render ──

  const CLR = '\x1b[K'
  const render = (lines: string[], hint: string) => {
    while (lines.length < h() - 2) lines.push('')
    const pad = Math.max(0, w() - hint.length - 4)
    const mark = dirty ? `${C}*${R} ` : '  '
    lines.push(`${BAR}${W} ${mark}${D}${hint}${' '.repeat(pad)}${R}`)
    process.stdout.write(`\x1b[H\x1b[?25l` + lines.map(l => l + CLR).join('\n') + '\x1b[J')
  }

  const draw = () => {
    const lines: string[] = []
    const path = cur().path

    if (mode.kind === 'folders') {
      const bc = path ? path.split('/').map(p => `${B}${p}${R}`).join(` ${D}/${R} `) : `${B}subscope config${R}`
      lines.push(`  ${bc}`)
      lines.push('')
      const rows = folderRows()
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i]!
        if (r.kind === 'gap') { lines.push(''); continue }
        if (r.kind === 'label') { lines.push(`  ${D}${r.text}${R}`); continue }
        const sel = i === cur().cursor
        const ptr = sel ? `${C}\u203a${R}` : ' '
        const ico = r.kind === 'folder'
          ? (r.active ? `${C}\u25b8${R}` : `${G}\u25b8${R}`)
          : (r.active ? `${C}\u25cf${R}` : `${G}\u25cb${R}`)
        const lbl = sel ? `${B}${r.text}${R}` : r.text
        const arrow = sel && r.kind === 'folder' ? `  ${D}\u2192${R}` : ''
        const tag = r.kind === 'mode' && r.active ? `  ${D}(default)${R}` : ''
        lines.push(` ${ptr} ${ico} ${lbl}${tag}${arrow}`)
      }
      render(lines, path
        ? '\u2191\u2193 move  space toggle  \u2192 open  \u2190 back  s sources  n new  e rename  d del  q save'
        : '\u2191\u2193 move  space toggle  \u2192 open  s sources  n new  e rename  d del  q save')

    } else if (mode.kind === 'sources') {
      lines.push(`  ${B}Sources${R} ${D}in ${path || '/'}${R}`)
      lines.push('')
      const srcs = sourcesIn(path)
      if (srcs.length === 0) lines.push(`  ${D}No sources. Press a to add.${R}`)
      for (let i = 0; i < srcs.length; i++) {
        const s = srcs[i]!
        const sel = i === mode.cursor
        const ptr = sel ? `${C}\u203a${R}` : ' '
        const ico = s.active ? `${C}\u25cf${R}` : `${G}\u25cb${R}`
        const lbl = sel ? `${B}${s.name}${R}` : s.name
        lines.push(` ${ptr} ${ico} ${lbl}  ${D}${s.type}${R}`)
        lines.push(`       ${D}${s.url}${R}`)
      }
      render(lines, '\u2191\u2193 move  space toggle  a add  e edit  d delete  q back')

    } else if (mode.kind === 'catalog') {
      lines.push(`  ${B}Add source${R}  ${D}type to search${R}`)
      lines.push(`  ${D}Search:${R} ${Y}${mode.search}\u2588${R}`)
      lines.push('')
      const existing = new Set(cfg.sources.map(s => s.url))
      const filtered = CATALOG.filter(e => {
        if (e.url && existing.has(e.url)) return false
        if (!mode.search) return true
        return e.label.toLowerCase().includes(mode.search.toLowerCase())
      })
      for (let i = 0; i < filtered.length; i++) {
        const e = filtered[i]!
        const sel = i === mode.cursor
        const ptr = sel ? `${C}\u203a${R}` : ' '
        const ico = e.template ? `${D}\u2026${R}` : `${C}+${R}`
        const lbl = sel ? `${B}${e.label}${R}` : e.label
        const hint = e.template ? `  ${D}${e.placeholder}${R}` : `  ${D}${e.url?.replace('https://', '')}${R}`
        lines.push(` ${ptr} ${ico} ${lbl}${hint}`)
      }
      if (filtered.length === 0) lines.push(`  ${D}No matches${R}`)
      // Store filtered list for key handler
      ;(mode as any)._filtered = filtered
      render(lines, '\u2191\u2193 select  enter confirm  q cancel')

    } else if (mode.kind === 'text') {
      const label = mode.purpose === 'new-folder' ? 'New folder'
        : mode.purpose === 'rename-folder' ? 'Rename'
        : mode.purpose === 'add-handle' ? (mode.meta?.placeholder ?? 'Input')
        : 'Input'
      lines.push(`  ${B}${label}${R}`)
      lines.push('')
      lines.push(`  ${Y}${mode.buf}\u2588${R}`)
      render(lines, 'enter confirm  q cancel')
    }
  }

  // ── Key handling ──

  process.stdout.write('\x1b[?1049h')
  draw()

  return new Promise<void>(resolve => {
    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.setEncoding('utf-8')

    const quit = () => {
      if (dirty) save(cfg)
      process.stdout.write('\x1b[?25h\x1b[?1049l')
      process.stdin.setRawMode(false)
      process.stdin.pause()
      process.stdin.removeListener('data', onKey)
      if (dirty) console.log('\n  Config saved.\n')
      resolve()
    }

    const onKey = (key: string) => {
      const up = key === '\x1b[A' || key === 'k'
      const down = key === '\x1b[B' || key === 'j'
      const right = key === '\x1b[C' || key === 'l'
      const left = key === '\x1b[D' || key === 'h'
      const enter = key === '\r'
      const ctrlc = key === '\x03'
      const backspace = key === '\x7f' || key === '\b'
      const printable = key.length === 1 && key.charCodeAt(0) >= 32

      // ── FOLDERS ──
      if (mode.kind === 'folders') {
        const rows = folderRows()
        if (up) { cur().cursor = findSel(rows, cur().cursor, -1); draw(); return }
        if (down) { cur().cursor = findSel(rows, cur().cursor, 1); draw(); return }
        if (key === ' ') {
          const r = rows[cur().cursor]
          if (r?.kind === 'mode') { cfg.defaultMode = r.key!; dirty = true; draw() }
          else if (r?.kind === 'folder') { toggleFolder(r.key!); dirty = true; draw() }
          return
        }
        if (right) {
          const r = rows[cur().cursor]
          if (r?.kind === 'folder') { nav.push({ path: r.key!, cursor: 0 }); cur().cursor = firstSel(folderRows()); draw() }
          return
        }
        if (left) { if (nav.length > 1) { nav.pop(); draw() }; return }
        if (key === 's') { mode = { kind: 'sources', cursor: 0 }; draw(); return }
        if (key === 'n') { mode = { kind: 'text', purpose: 'new-folder', buf: '' }; draw(); return }
        if (key === 'e') {
          const r = rows[cur().cursor]
          if (r?.kind === 'folder') mode = { kind: 'text', purpose: 'rename-folder', buf: r.key!.split('/').pop()!, meta: r.key }
          draw(); return
        }
        if (key === 'd') {
          const r = rows[cur().cursor]
          if (r?.kind === 'folder') {
            const p = r.key!
            if (!cfg.sources.some(s => s.group === p || s.group.startsWith(p + '/'))) {
              cfg.folders = cfg.folders.filter(f => f !== p && !f.startsWith(p + '/'))
              cfg.activeGroups = cfg.activeGroups.filter(g => g !== p && !g.startsWith(p + '/'))
              dirty = true
              const newRows = folderRows()
              cur().cursor = Math.min(cur().cursor, Math.max(0, newRows.length - 1))
            }
          }
          draw(); return
        }
        if (key === 'q' || enter || ctrlc) { quit(); return }
        return
      }

      // ── SOURCES ──
      if (mode.kind === 'sources') {
        const srcs = sourcesIn(cur().path)
        if (up) { mode.cursor = Math.max(0, mode.cursor - 1); draw(); return }
        if (down) { mode.cursor = Math.min(srcs.length - 1, mode.cursor + 1); draw(); return }
        if (key === ' ') { const s = srcs[mode.cursor]; if (s) { s.active = !s.active; dirty = true; draw() }; return }
        if (key === 'a') { mode = { kind: 'catalog', search: '', cursor: 0 }; draw(); return }
        if (key === 'e') {
          const s = srcs[mode.cursor]
          if (s) mode = { kind: 'text', purpose: 'add-handle', buf: s.name, meta: { editId: s.id } }
          draw(); return
        }
        if (key === 'd') {
          const s = srcs[mode.cursor]
          if (s) {
            cfg.sources = cfg.sources.filter(x => x.id !== s.id)
            dirty = true
            mode.cursor = Math.min(mode.cursor, Math.max(0, sourcesIn(cur().path).length - 1))
          }
          draw(); return
        }
        if (key === 'q' || ctrlc) { mode = { kind: 'folders' }; draw(); return }
        return
      }

      // ── CATALOG ──
      if (mode.kind === 'catalog') {
        const filtered: CatalogEntry[] = (mode as any)._filtered ?? []
        if (up) { mode.cursor = Math.max(0, mode.cursor - 1); draw(); return }
        if (down) { mode.cursor = Math.min(filtered.length - 1, mode.cursor + 1); draw(); return }
        if (enter) {
          const entry = filtered[mode.cursor]
          if (entry?.url) {
            const group = cur().path || 'ungrouped'
            const src = mkSource(entry, entry.url, group)
            if (!cfg.sources.some(s => s.url === src.url)) { cfg.sources.push(src); dirty = true }
            mode = { kind: 'sources', cursor: 0 }
          } else if (entry?.template) {
            mode = { kind: 'text', purpose: 'add-handle', buf: '', meta: { entry } }
          }
          draw(); return
        }
        if (backspace) { mode.search = mode.search.slice(0, -1); mode.cursor = 0; draw(); return }
        if (key === 'q' || ctrlc) { mode = { kind: 'sources', cursor: 0 }; draw(); return }
        // In catalog, typing filters — don't use j/k for navigation (conflicts with search)
        if (printable && key !== 'j' && key !== 'k') { mode.search += key; mode.cursor = 0; draw(); return }
        return
      }

      // ── TEXT INPUT ──
      if (mode.kind === 'text') {
        if (enter) {
          const val = mode.buf.trim()
          if (val) {
            if (mode.purpose === 'new-folder') {
              const p = cur().path ? `${cur().path}/${val}` : val
              if (!cfg.folders.includes(p)) cfg.folders.push(p)
              if (!cfg.activeGroups.includes(p)) cfg.activeGroups.push(p)
              dirty = true
            } else if (mode.purpose === 'rename-folder') {
              const oldPath = mode.meta as string
              const newPath = cur().path ? `${cur().path}/${val}` : val
              const rn = (p: string) => p === oldPath ? newPath : p.startsWith(oldPath + '/') ? newPath + p.slice(oldPath.length) : p
              cfg.folders = cfg.folders.map(rn)
              cfg.activeGroups = cfg.activeGroups.map(rn)
              cfg.sources.forEach(s => { s.group = rn(s.group) })
              dirty = true
            } else if (mode.purpose === 'add-handle' && mode.meta?.entry) {
              const handle = val.replace(/^@/, '')
              const url = mode.meta.entry.template.replace('{handle}', handle)
              const group = cur().path || 'ungrouped'
              const src = mkSource(mode.meta.entry, url, group)
              if (!cfg.sources.some(s => s.url === src.url)) { cfg.sources.push(src); dirty = true }
            } else if (mode.purpose === 'add-handle' && mode.meta?.editId) {
              const src = cfg.sources.find(s => s.id === mode.meta.editId)
              if (src) { src.name = val; dirty = true }
            }
          }
          mode = mode.purpose === 'new-folder' || mode.purpose === 'rename-folder'
            ? { kind: 'folders' } : { kind: 'sources', cursor: 0 }
          draw(); return
        }
        if (key === 'q' && mode.buf === '' || ctrlc) {
          mode = mode.purpose === 'new-folder' || mode.purpose === 'rename-folder'
            ? { kind: 'folders' } : { kind: 'sources', cursor: 0 }
          draw(); return
        }
        if (backspace) { mode.buf = mode.buf.slice(0, -1); draw(); return }
        if (printable) { mode.buf += key; draw(); return }
        return
      }
    }

    process.stdin.on('data', onKey)
  })
}

const mkSource = (entry: CatalogEntry, url: string, group: string): Source => {
  const parsed = new URL(url)
  const host = parsed.hostname.replace('www.', '')
  const path = parsed.pathname.replace(/\/+$/, '')
  return {
    id: createHash('sha256').update(url).digest('hex').slice(0, 8),
    url, type: entry.type, group, active: true,
    name: path && path !== '/' ? `${host}${path}` : host,
    addedAt: new Date().toISOString(),
  }
}
