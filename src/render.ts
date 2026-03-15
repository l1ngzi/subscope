import type { FeedItem } from './types.ts'

// ── ANSI palette ──

const RESET = '\x1b[0m'
const BOLD = '\x1b[1m'
const DIM = '\x1b[2m'
const ITALIC = '\x1b[3m'
const WHITE = '\x1b[37m'
const GRAY = '\x1b[90m'
const BG_BAR = '\x1b[48;5;236m'

// 256-color source palette
const c = (n: number) => `\x1b[38;5;${n}m`
const ORANGE = c(208)   // Anthropic
const PEACH = c(216)     // Claude
const RED = c(196)       // YouTube
const BLUE = c(75)       // X / Twitter
const GREEN = c(114)     // GitHub
const TEAL = c(80)       // DeepSeek
const PURPLE = c(141)    // default / other
const GOLD = c(178)      // Economics
const NAVY = c(27)       // SEC

// ── Source color mapping ──

const sourceColor = (name: string, type: string, group?: string): string => {
  const g = group?.toLowerCase() ?? ''
  const n = name.toLowerCase()
  // Brand colors by group
  if (g === 'anthropic' || n.includes('anthropic')) return ORANGE
  if (g === 'claude' || n.includes('claude') || n.includes('support')) return PEACH
  if (g === 'openai' || n.includes('openai') || n.includes('openai')) return GREEN
  if (g === 'deepmind' || n.includes('deepmind') || n.includes('googledeepmind')) return BLUE
  if (g === 'deepseek' || n.includes('deepseek')) return TEAL
  if (g === 'xai' || n.includes('x.ai') || n.includes('/xai') || n.includes('grok')) return c(231) // white
  if (n.includes('github')) return c(248) // light gray
  // Economics & Finance
  if (g.startsWith('econ/fed') || n.includes('federalreserve')) return c(39)  // sky blue
  if (g.startsWith('econ/pboc') || n.includes('pbc.gov')) return c(160) // red
  if (g.startsWith('econ/nbs') || n.includes('stats.gov')) return GOLD
  if (g.startsWith('econ/sec') || n.includes('efts.sec') || n.includes('edgar')) return NAVY
  if (g.startsWith('econ/bls') || n.includes('bls.gov')) return c(107) // olive
  if (g.startsWith('econ/bea') || n.includes('bea.gov')) return c(107) // olive
  if (g.startsWith('econ/ecb') || n.includes('ecb.europa')) return c(33)  // blue
  if (g.startsWith('econ/treasury') || n.includes('treasury')) return c(220) // yellow
  if (g.startsWith('econ/imf') || n.includes('imf.org')) return c(75) // light blue
  return PURPLE
}

// ── Helpers ──

const cols = () => process.stdout.columns || 80
const rows = () => process.stdout.rows || 24
const PREFIX_LEN = 4

const truncate = (text: string, max: number) =>
  text.length <= max ? text : text.slice(0, max - 1) + '\u2026'

const formatSourceName = (name: string): string => {
  if (!name) return 'unknown'
  if (name.startsWith('support.claude')) {
    const slug = name.split('/').pop()?.replace(/^\d+-/, '') ?? 'support'
    return `Claude Support \u00b7 ${slug}`
  }
  // Economics & Finance
  if (name.includes('federalreserve.gov')) return 'Federal Reserve'
  if (name.includes('pbc.gov.cn')) return '\u4e2d\u56fd\u4eba\u6c11\u94f6\u884c'  // 中国人民银行
  if (name.includes('stats.gov.cn')) return '\u56fd\u5bb6\u7edf\u8ba1\u5c40'      // 国家统计局
  if (name.includes('efts.sec.gov') || name.includes('sec.gov')) return 'SEC EDGAR'
  if (name.includes('bls.gov')) return 'BLS'
  if (name.includes('bea.gov')) return 'BEA'
  if (name.includes('ecb.europa')) return 'ECB'
  if (name.includes('treasury.gov')) return 'US Treasury'
  if (name.includes('imf.org')) return 'IMF'
  const parts = name
    .replace(/\.(com|org|net|io|ai|dev)/, '')
    .split('/')
    .filter(p => !p.match(/\.(xml|json|atom|rss)$/))  // strip feed file extensions
  parts[0] = parts[0]!.charAt(0).toUpperCase() + parts[0]!.slice(1)
  return parts.join(' \u00b7 ')
}

const timeAgo = (iso: string): string => {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

// ── Format single feed item ──

const formatItem = (item: FeedItem, maxWidth: number): string[] => {
  const color = sourceColor(item.sourceName, item.sourceType)
  const lines: string[] = []

  const cleanText = (s: string) => s.replace(/<[^>]*>/g, '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim()

  lines.push(` ${color}\u250c\u2500${RESET} ${BOLD}${truncate(cleanText(item.title), maxWidth)}${RESET}`)
  if (item.summary) {
    const cleaned = cleanText(item.summary)
    if (cleaned) {
      lines.push(` ${color}\u2502${RESET}  ${DIM}${truncate(cleaned, maxWidth)}${RESET}`)
    }
  }
  const srcName = formatSourceName(item.sourceName)
  const time = timeAgo(item.publishedAt)
  lines.push(` ${color}\u2502${RESET}  ${color}${srcName}${RESET} ${GRAY}\u00b7 ${time}${RESET}`)
  lines.push(` ${color}\u2502${RESET}  ${DIM}\u2192 ${item.url}${RESET}`)
  lines.push('')
  return lines
}

// ── Non-interactive feed ──

export const renderFeed = (items: FeedItem[], olderCount = 0, hasSources = true): void => {
  if (items.length === 0) {
    if (!hasSources) {
      console.log(`\n${DIM}  No sources configured. Try:${RESET}`)
      console.log(`${DIM}    subscope add <url>${RESET}`)
      console.log(`${DIM}    subscope fetch${RESET}\n`)
    } else if (olderCount > 0) {
      console.log(`\n${DIM}  No updates in the last 14 days.${RESET}`)
      console.log(`${DIM}  ${olderCount} older items available: subscope --all${RESET}\n`)
    } else {
      console.log(`\n${DIM}  No items yet. Try: subscope fetch${RESET}\n`)
    }
    return
  }

  console.log()
  const maxWidth = cols() - PREFIX_LEN
  for (const item of items) {
    for (const line of formatItem(item, maxWidth)) console.log(line)
  }

  if (olderCount > 0) {
    console.log(` ${GRAY}\u2500\u2500\u2500 ${olderCount} older items \u00b7 subscope --all${RESET}`)
    console.log()
  }
}

// ── Interactive browser ──

const NEW_BADGE = `\x1b[48;5;22m\x1b[38;5;46m NEW ${RESET}`
const SEL_COLOR = '\x1b[48;5;237m'

// Track seen items across sessions
const SEEN_FILE = (() => {
  const { join } = require('path') as typeof import('path')
  const { homedir } = require('os') as typeof import('os')
  return join(homedir(), '.subscope', 'seen.json')
})()

const loadSeen = (): Set<string> => {
  try {
    const { readFileSync, existsSync } = require('fs') as typeof import('fs')
    if (!existsSync(SEEN_FILE)) return new Set()
    return new Set(JSON.parse(readFileSync(SEEN_FILE, 'utf-8')))
  } catch { return new Set() }
}

const saveSeen = (seen: Set<string>) => {
  try {
    const { writeFileSync } = require('fs') as typeof import('fs')
    // Keep last 5000 IDs to avoid growing forever
    const arr = [...seen].slice(-5000)
    writeFileSync(SEEN_FILE, JSON.stringify(arr))
  } catch {}
}

const formatItemSel = (item: FeedItem, maxWidth: number, selected: boolean, isNew: boolean): string[] => {
  const color = sourceColor(item.sourceName, item.sourceType)
  const bg = selected ? SEL_COLOR : ''
  const lines: string[] = []
  const cleanText = (s: string) => s.replace(/<[^>]*>/g, '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim()

  const badge = isNew ? ` ${NEW_BADGE}` : ''
  const ptr = selected ? `${color}\u25b6${RESET}` : `${color}\u250c\u2500${RESET}`

  lines.push(`${bg} ${ptr} ${BOLD}${truncate(cleanText(item.title), maxWidth - (isNew ? 6 : 0))}${RESET}${badge}`)
  if (item.summary) {
    const cleaned = cleanText(item.summary)
    if (cleaned) lines.push(`${bg} ${color}\u2502${RESET}  ${DIM}${truncate(cleaned, maxWidth)}${RESET}`)
  }
  const srcName = formatSourceName(item.sourceName)
  lines.push(`${bg} ${color}\u2502${RESET}  ${color}${srcName}${RESET} ${GRAY}\u00b7 ${timeAgo(item.publishedAt)}${RESET}`)
  lines.push(`${bg} ${color}\u2502${RESET}  ${DIM}\u2192 ${item.url}${RESET}`)
  lines.push('')
  return lines
}

export const renderInteractive = (allItems: FeedItem[], olderCount = 0, hasSources = true): Promise<void> => {
  if (allItems.length === 0) {
    renderFeed(allItems, olderCount, hasSources)
    return Promise.resolve()
  }

  if (allItems.length <= 3) {
    console.log()
    const maxWidth = cols() - PREFIX_LEN
    for (const item of allItems) for (const line of formatItem(item, maxWidth)) console.log(line)
    return Promise.resolve()
  }

  // State
  let cursor = 0         // -1 = search box focused, 0+ = item index
  let search = ''        // current search query
  let items = allItems   // filtered view

  const seen = loadSeen()
  const newIds = new Set(allItems.filter(i => !seen.has(i.id)).map(i => i.id))
  for (const item of allItems) seen.add(item.id)
  saveSeen(seen)

  const applyFilter = () => {
    if (!search) { items = allItems; return }
    const q = search.toLowerCase()
    items = allItems.filter(i =>
      i.title.toLowerCase().includes(q) ||
      (i.summary?.toLowerCase().includes(q)) ||
      i.sourceName.toLowerCase().includes(q) ||
      i.url.toLowerCase().includes(q)
    )
  }

  const itemHeight = (item: FeedItem) => {
    const hasSummary = item.summary && item.summary.replace(/<[^>]*>/g, '').trim()
    return hasSummary ? 5 : 4
  }

  const draw = () => {
    const maxWidth = cols() - PREFIX_LEN
    const termH = rows()
    const lines: string[] = []

    // Search bar (always at top)
    const searchFocused = cursor === -1
    if (searchFocused) {
      lines.push(`  ${c(36)}\u25b6${RESET} ${DIM}search:${RESET} ${search}\x1b[7m \x1b[27m`)
    } else if (search) {
      lines.push(`  ${DIM}search: ${search}${RESET}  ${GRAY}(${items.length} results)${RESET}`)
    } else {
      lines.push(`  ${DIM}/ search${RESET}`)
    }
    lines.push('')

    const headerH = 2
    const available = termH - headerH - 1 // -1 for status bar

    if (items.length === 0) {
      lines.push(`  ${DIM}No results for "${search}"${RESET}`)
    } else {
      const effCursor = Math.max(0, cursor)

      // Find scroll start
      let startIdx = 0
      let totalH = 0
      for (let i = 0; i < items.length; i++) {
        const ih = itemHeight(items[i]!)
        if (totalH + ih > available && i <= effCursor) {
          startIdx = i
          totalH = 0
        }
        totalH += ih
      }
      if (startIdx > effCursor) startIdx = effCursor

      for (let i = startIdx; i < items.length; i++) {
        const itemLines = formatItemSel(items[i]!, maxWidth, i === effCursor && cursor >= 0, newIds.has(items[i]!.id))
        if (lines.length - headerH + itemLines.length > available) break
        lines.push(...itemLines)
      }
    }

    while (lines.length < termH - 1) lines.push('')

    // Status bar
    const pos = cursor >= 0 ? `${cursor + 1}/${items.length}` : `${items.length} items`
    const hint = cursor === -1
      ? 'type to search  \u2193 browse  q quit'
      : '\u2191\u2193 browse  / search  enter open  g pdf  q quit'
    const gap = Math.max(1, cols() - pos.length - hint.length - 4)
    lines.push(`${BG_BAR}${WHITE} ${pos}${' '.repeat(gap)}${DIM}${hint}${RESET}`)

    process.stdout.write(`\x1b[H\x1b[?25l${lines.map(l => l + '\x1b[K').join('\n')}\x1b[J`)
  }

  process.stdout.write('\x1b[?1049h')
  draw()

  return new Promise<void>(resolve => {
    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.setEncoding('utf-8')

    const cleanup = () => {
      process.stdout.write('\x1b[?25h\x1b[?1049l')
      process.stdin.setRawMode(false)
      process.stdin.pause()
      process.stdin.removeListener('data', onKey)
      resolve()
    }

    const openUrl = (url: string) => {
      Bun.spawnSync(['cmd', '/c', 'start', '', url.replace(/&/g, '^&')], { stdout: 'ignore', stderr: 'ignore' })
    }

    const downloadPaper = async (item: FeedItem) => {
      const pdfUrl = toPdfUrl(item.url)
      if (!pdfUrl) return

      const { join } = require('path') as typeof import('path')
      const { homedir } = require('os') as typeof import('os')
      const { writeFileSync, readFileSync, mkdirSync, existsSync } = require('fs') as typeof import('fs')
      const { parse: yamlParse } = require('yaml') as typeof import('yaml')

      // Load auth cookies
      const authFile = join(homedir(), '.subscope', 'auth.yml')
      let cookies = ''
      try {
        const auth = yamlParse(readFileSync(authFile, 'utf-8')) as any
        const domain = new URL(pdfUrl).hostname.replace('www.', '')
        // Match by domain: nature, ieee, acs, arxiv, science
        cookies = auth?.[domain]?.cookies ?? auth?.academic?.cookies ?? ''
      } catch {}

      const dir = join(homedir(), 'Downloads', 'subscope')
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

      const safeName = item.title.replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80)
      const filePath = join(dir, `${safeName}.pdf`)

      process.stdout.write(`\x1b[${rows() - 1};1H\x1b[K  ${DIM}Downloading...${RESET}`)

      try {
        const headers: Record<string, string> = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        if (cookies) headers['Cookie'] = cookies

        const res = await fetch(pdfUrl, { headers, redirect: 'follow' })
        if (!res.ok) throw new Error(`${res.status}`)

        const ct = res.headers.get('content-type') ?? ''
        if (!ct.includes('pdf') && !ct.includes('octet-stream')) {
          // Got HTML instead of PDF — auth failed, fallback to browser
          openUrl(pdfUrl)
          process.stdout.write(`\x1b[${rows() - 1};1H\x1b[K  ${DIM}Auth needed. Opened in browser.${RESET}`)
          setTimeout(draw, 1500)
          return
        }

        const buf = await res.arrayBuffer()
        writeFileSync(filePath, Buffer.from(buf))
        process.stdout.write(`\x1b[${rows() - 1};1H\x1b[K  ${DIM}Saved: ~/Downloads/subscope/${safeName}.pdf${RESET}`)
      } catch {
        openUrl(pdfUrl)
        process.stdout.write(`\x1b[${rows() - 1};1H\x1b[K  ${DIM}Opened in browser.${RESET}`)
      }
      setTimeout(draw, 2000)
    }

    const onKey = (key: string) => {
      if (key === '\x03') { cleanup(); return } // ctrl-c always quits

      if (key === 'q' || key === '\x03') { cleanup(); return }

      // Search box focused
      if (cursor === -1) {
        if (key === '\x1b[B') { // down: enter browse mode
          cursor = items.length > 0 ? 0 : -1; draw(); return
        }
        if (key === '\r') { // enter: apply search, jump to results
          applyFilter(); cursor = items.length > 0 ? 0 : -1; draw(); return
        }
        if (key === '\x7f' || key === '\b') {
          search = search.slice(0, -1); applyFilter(); draw(); return
        }
        if (key.length === 1 && key.charCodeAt(0) >= 32) {
          search += key; applyFilter(); draw(); return
        }
        return
      }

      // Browse mode
      if (key === '\x1b[A' || key === 'k') {
        if (cursor > 0) { cursor--; newIds.delete(items[cursor]!.id); draw() }
        else { cursor = -1; draw() } // up past first item = search box
        return
      }
      if (key === '\x1b[B' || key === 'j') {
        if (cursor < items.length - 1) { cursor++; newIds.delete(items[cursor]!.id); draw() }
        return
      }
      if (key === '/') { cursor = -1; draw(); return } // jump to search
      if (key === '\r') { openUrl(items[cursor]!.url); return }
      if (key === 'g') { downloadPaper(items[cursor]!); return }
    }

    process.stdin.on('data', onKey)
  })
}

// ── PDF URL resolver ──

const toPdfUrl = (url: string): string | null => {
  // Nature journals: append .pdf
  if (url.includes('nature.com/articles/')) return url + '.pdf'
  // arXiv: /abs/ → /pdf/
  if (url.includes('arxiv.org/abs/')) return url.replace('/abs/', '/pdf/') + '.pdf'
  // Science: append .full.pdf
  if (url.includes('science.org/doi/')) return url.replace('/doi/', '/doi/pdf/')
  // IEEE: convert to PDF endpoint
  if (url.includes('ieeexplore.ieee.org')) {
    const id = url.match(/document\/(\d+)/)?.[1]
    if (id) return `https://ieeexplore.ieee.org/stampPDF/getPDF.jsp?arnumber=${id}`
  }
  // ACS: append .pdf
  if (url.includes('pubs.acs.org/doi/')) return url.replace('/doi/', '/doi/pdf/')
  return null
}

// ── Sources list ──

export const renderSources = (sources: { id: string; type: string; name: string; url: string; group?: string; active?: boolean }[]): void => {
  if (sources.length === 0) {
    console.log(`\n${DIM}  No sources. Add one with: subscope add <url>${RESET}\n`)
    return
  }

  console.log()
  for (const s of sources) {
    const color = sourceColor(s.name, s.type, s.group)
    const status = s.active === false ? `${GRAY}\u25cb${RESET}` : `${color}\u25cf${RESET}`
    const grp = s.group ? `${DIM}[${s.group}]${RESET}` : ''
    console.log(`  ${status} ${BOLD}${s.id}${RESET}  ${s.name}  ${grp}`)
    console.log(`             ${DIM}${s.url}${RESET}`)
  }
  console.log()
}

// ── Groups list ──

export const renderGroups = (config: { activeGroups: string[]; sources: { group: string; active?: boolean; name: string; type: string }[] }): void => {
  const groups = [...new Set(config.sources.map(s => s.group))].sort()
  if (groups.length === 0) {
    console.log(`\n${DIM}  No groups.${RESET}\n`)
    return
  }

  // Build tree from paths
  const printed = new Set<string>()
  console.log()

  for (const g of groups) {
    const parts = g.split('/')
    // Print parent nodes that haven't been printed yet
    for (let i = 0; i < parts.length - 1; i++) {
      const prefix = parts.slice(0, i + 1).join('/')
      if (printed.has(prefix)) continue
      printed.add(prefix)

      const indent = '  '.repeat(i)
      const isActive = config.activeGroups.some(ag => ag === prefix || ag.startsWith(prefix + '/'))
      const childSources = config.sources.filter(s => s.group.startsWith(prefix + '/') || s.group === prefix)
      const activeCount = childSources.filter(s => s.active !== false).length
      const icon = isActive ? `${BOLD}\u25b8${RESET}` : `${GRAY}\u25b8${RESET}`
      const label = isActive ? `${BOLD}${parts[i]}${RESET}` : `${GRAY}${parts[i]}${RESET}`
      console.log(`${indent}  ${icon} ${label}  ${DIM}${activeCount}/${childSources.length} sources${RESET}`)
    }

    // Print the leaf group
    const depth = parts.length - 1
    const indent = '  '.repeat(depth)
    const leafName = parts[parts.length - 1]!
    const isActive = config.activeGroups.includes(g) || config.activeGroups.some(ag => g.startsWith(ag + '/'))
    const sample = config.sources.find(s => s.group === g)!
    const color = sourceColor(sample.name, sample.type, g)
    const icon = isActive ? `${color}\u25cf${RESET}` : `${GRAY}\u25cb${RESET}`
    const sources = config.sources.filter(s => s.group === g)
    const activeCount = sources.filter(s => s.active !== false).length
    const label = isActive ? `${BOLD}${leafName}${RESET}` : `${GRAY}${leafName}${RESET}`
    console.log(`${indent}  ${icon} ${label}  ${DIM}${activeCount}/${sources.length} sources${RESET}`)
  }

  console.log(`\n  ${DIM}subscope group <path> on/off${RESET}`)
  console.log()
}
