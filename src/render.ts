import type { FeedItem } from './types.ts'

const RESET = '\x1b[0m'
const BOLD = '\x1b[1m'
const DIM = '\x1b[2m'
const CYAN = '\x1b[36m'
const GRAY = '\x1b[90m'
const WHITE = '\x1b[37m'
const BG_GRAY = '\x1b[48;5;236m'

const cols = () => process.stdout.columns || 80
const rows = () => process.stdout.rows || 24
const PREFIX_LEN = 4

const truncate = (text: string, max: number) =>
  text.length <= max ? text : text.slice(0, max - 1) + '\u2026'

// "anthropic.com/blog" → "Anthropic · blog"
// "support.claude.com/en/collections/18031876-usage-and-limits" → "Claude Support · usage-and-limits"
const formatSourceName = (name: string): string => {
  if (!name) return 'unknown'

  // Special case: support.claude.com → "Claude Support · <slug>"
  if (name.startsWith('support.claude')) {
    const slug = name.split('/').pop()?.replace(/^\d+-/, '') ?? 'support'
    return `Claude Support \u00b7 ${slug}`
  }

  // Strip TLD, split by "/", capitalize first segment
  const parts = name.replace(/\.(com|org|net|io|ai|dev)/, '').split('/')
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

const formatItem = (item: FeedItem, maxWidth: number): string[] => {
  const lines: string[] = []
  lines.push(` ${CYAN}\u250c\u2500${RESET} ${BOLD}${truncate(item.title, maxWidth)}${RESET}`)
  if (item.summary) {
    const cleaned = item.summary.replace(/<[^>]*>/g, '').trim()
    if (cleaned) {
      lines.push(` ${CYAN}\u2502${RESET}  ${DIM}${truncate(cleaned, maxWidth)}${RESET}`)
    }
  }
  lines.push(` ${CYAN}\u2502${RESET}  ${GRAY}${formatSourceName(item.sourceName)} \u00b7 ${timeAgo(item.publishedAt)}${RESET}`)
  lines.push(` ${CYAN}\u2502${RESET}  ${DIM}\u2192 ${item.url}${RESET}`)
  lines.push('')
  return lines
}

// ── non-interactive (for pipes / -n) ──

export const renderFeed = (items: FeedItem[], olderCount = 0): void => {
  if (items.length === 0) {
    console.log(`\n${DIM}  No items yet. Try:${RESET}`)
    console.log(`${DIM}    subscope add <url>${RESET}`)
    console.log(`${DIM}    subscope fetch${RESET}\n`)
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

// ── interactive pager ──

export const renderInteractive = (items: FeedItem[]): Promise<void> => {
  if (items.length === 0) {
    console.log(`\n${DIM}  No items yet. Try:${RESET}`)
    console.log(`${DIM}    subscope add <url>${RESET}`)
    console.log(`${DIM}    subscope fetch${RESET}\n`)
    return Promise.resolve()
  }

  // Pre-render all items into line groups
  const maxWidth = cols() - PREFIX_LEN
  const rendered = items.map(item => formatItem(item, maxWidth))

  // Paginate by terminal height
  const footerHeight = 2
  const availableRows = rows() - footerHeight
  const pages: string[][] = []
  let current: string[] = []

  for (const group of rendered) {
    if (current.length + group.length > availableRows && current.length > 0) {
      pages.push(current)
      current = []
    }
    current.push(...group)
  }
  if (current.length > 0) pages.push(current)

  if (pages.length <= 1) {
    // Only one page — no need for interactive mode
    console.log()
    for (const line of (pages[0] ?? [])) console.log(line)
    return Promise.resolve()
  }

  let page = 0

  const draw = () => {
    // Alternate screen would be nicer, but clear is simpler and more compatible
    process.stdout.write('\x1b[2J\x1b[H') // clear + cursor home
    process.stdout.write('\n')
    for (const line of pages[page]!) {
      process.stdout.write(line + '\n')
    }
    // Pad remaining space
    const used = (pages[page]?.length ?? 0) + footerHeight + 1
    const padding = Math.max(0, rows() - used)
    for (let i = 0; i < padding; i++) process.stdout.write('\n')
    // Status bar
    const left = page > 0 ? '\u2190' : ' '
    const right = page < pages.length - 1 ? '\u2192' : ' '
    const status = ` ${left}  Page ${page + 1}/${pages.length}  ${right}`
    const hint = 'q quit'
    const gap = Math.max(1, cols() - status.length - hint.length - 2)
    process.stdout.write(`${BG_GRAY}${WHITE}${status}${' '.repeat(gap)}${DIM}${hint}${RESET}\n`)
  }

  return new Promise<void>(resolve => {
    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.setEncoding('utf-8')

    const cleanup = () => {
      process.stdin.setRawMode(false)
      process.stdin.pause()
      process.stdin.removeListener('data', onKey)
      process.stdout.write('\x1b[2J\x1b[H') // clear on exit
      resolve()
    }

    const onKey = (key: string) => {
      if (key === 'q' || key === '\x1b' || key === '\x03') { // q, ESC, Ctrl+C
        cleanup()
        return
      }
      if ((key === '\x1b[C' || key === 'l') && page < pages.length - 1) { // right, l
        page++
        draw()
      }
      if ((key === '\x1b[D' || key === 'h') && page > 0) { // left, h
        page--
        draw()
      }
    }

    process.stdin.on('data', onKey)
    draw()
  })
}

// ── sources list ──

export const renderSources = (sources: { id: string; type: string; name: string; url: string; group?: string; active?: boolean }[]): void => {
  if (sources.length === 0) {
    console.log(`\n${DIM}  No sources. Add one with: subscope add <url>${RESET}\n`)
    return
  }

  console.log()
  for (const s of sources) {
    const status = s.active === false ? `${GRAY}\u25cb${RESET}` : `${CYAN}\u25cf${RESET}`
    const grp = s.group ? `${DIM}[${s.group}]${RESET}` : ''
    console.log(`  ${status} ${BOLD}${s.id}${RESET}  ${s.name}  ${grp}`)
    console.log(`             ${DIM}${s.url}${RESET}`)
  }
  console.log()
}

export const renderGroups = (config: { activeGroups: string[]; sources: { group: string; active?: boolean }[] }): void => {
  const groups = [...new Set(config.sources.map(s => s.group))]
  if (groups.length === 0) {
    console.log(`\n${DIM}  No groups.${RESET}\n`)
    return
  }

  console.log()
  for (const g of groups) {
    const active = config.activeGroups.includes(g)
    const icon = active ? `${CYAN}\u25cf${RESET}` : `${GRAY}\u25cb${RESET}`
    const sources = config.sources.filter(s => s.group === g)
    const activeCount = sources.filter(s => s.active !== false).length
    const label = active ? `${BOLD}${g}${RESET}` : `${GRAY}${g}${RESET}`
    console.log(`  ${icon} ${label}  ${DIM}${activeCount}/${sources.length} sources${RESET}`)
  }
  console.log(`\n  ${DIM}subscope group <name> on/off${RESET}`)
  console.log()
}
