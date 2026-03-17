import { join } from 'path'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { parse as yamlParse } from 'yaml'
import { DIR } from './lib.ts'
import type { FeedItem } from './types.ts'

// ── ANSI palette ──

const RESET = '\x1b[0m'
const BOLD = '\x1b[1m'
const DIM = '\x1b[2m'
const GRAY = '\x1b[90m'
const WHITE = '\x1b[37m'
const BG_BAR = '\x1b[48;5;236m'
const SEL_COLOR = '\x1b[48;5;237m'
const NEW_BADGE = `\x1b[48;5;22m\x1b[38;5;46m NEW ${RESET}`

const c = (n: number) => `\x1b[38;5;${n}m`

// ── Source color ──

const BRAND: [string, number][] = [
  ['anthropic', 208], ['claude', 216],
  ['openai', 114], ['deepmind', 75], ['deepseek', 80],
  ['blog.google', 33], ['google', 33], ['nvidia', 76],
  ['xai', 231], ['x.ai', 231], ['grok', 231],
  ['github', 248],
  ['fed', 39], ['federalreserve', 39],
  ['pboc', 160], ['pbc.gov', 160],
  ['nbs', 178], ['stats.gov', 178],
  ['sec', 27], ['edgar', 27],
  ['bls', 107], ['bea', 107],
  ['ecb', 33], ['treasury', 220], ['imf', 75], ['cfpb', 29], ['consumerfinance', 29],
  ['mof', 172], ['safe', 75], ['nfra', 214], ['csrc', 196],
  ['bbc', 167], ['france24', 75], ['dw', 33], ['nhk', 204], ['aljazeera', 214],
  ['people', 196], ['cctv', 160], ['xinhua', 196], ['tass', 75],
  ['yonhap', 39], ['yna.co.kr', 39],
  ['abc-au', 40], ['abc.net.au', 40],
  ['cbc', 160],
  ['channelnewsasia', 160], ['cna', 160],
  ['aa.com.tr', 196], ['anadolu', 196],
  ['apnews', 255], ['focustaiwan', 39], ['thehindu', 208], ['boj', 231],
  ['iea', 214], ['eia', 107], ['doe', 39],
  ['opec', 178], ['opec.org', 178], ['irena', 77],
  ['un', 75], ['who', 39], ['iaea', 220], ['wto', 33],
  ['eu', 33], ['ec.europa', 33],
  ['cftc', 33], ['cftc.gov', 33],  // before ftc (cftc contains ftc)
  ['ftc', 107], ['ftc.gov', 107],
  ['nato', 27], ['nato.int', 27],
]

const sourceColor = (name: string, _type: string, group?: string): string => {
  const key = ((group ?? '') + ' ' + name).toLowerCase()
  for (const [match, color] of BRAND)
    if (key.includes(match)) return c(color)
  return c(141)
}

// ── Helpers ──

const cols = () => process.stdout.columns || 80
const rows = () => process.stdout.rows || 24

const isWide = (cp: number): boolean =>
  // CJK
  (cp >= 0x1100 && cp <= 0x115f) ||
  (cp >= 0x2e80 && cp <= 0xa4cf && cp !== 0x303f) ||
  (cp >= 0xac00 && cp <= 0xd7a3) ||
  (cp >= 0xf900 && cp <= 0xfaff) ||
  (cp >= 0xfe10 && cp <= 0xfe19) ||
  (cp >= 0xfe30 && cp <= 0xfe6b) ||
  (cp >= 0xff01 && cp <= 0xff60) ||
  (cp >= 0xffe0 && cp <= 0xffe6) ||
  (cp >= 0x20000 && cp <= 0x3fffd) ||
  // Emoji (rendered as 2-cell wide in terminals)
  (cp >= 0x231a && cp <= 0x23ff) ||
  (cp >= 0x2600 && cp <= 0x27bf) ||
  (cp >= 0x2b50 && cp <= 0x2b55) ||
  (cp >= 0x1f000 && cp <= 0x1faff)

const displayWidth = (s: string): number => {
  let w = 0
  for (const ch of s) w += isWide(ch.codePointAt(0)!) ? 2 : 1
  return w
}

const truncate = (text: string, max: number) => {
  if (displayWidth(text) <= max) return text
  let w = 0, result = ''
  for (const ch of text) {
    const cw = isWide(ch.codePointAt(0)!) ? 2 : 1
    if (w + cw > max - 1) return result + '\u2026'
    w += cw
    result += ch
  }
  return result + '\u2026'
}

const clean = (s: string) =>
  s.replace(/<[^>]*>/g, '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim()

const DISPLAY: [string, string][] = [
  ['federalreserve.gov', 'Federal Reserve'],
  ['pbc.gov.cn', '\u4e2d\u56fd\u4eba\u6c11\u94f6\u884c'],
  ['stats.gov.cn', '\u56fd\u5bb6\u7edf\u8ba1\u5c40'],
  ['efts.sec.gov', 'SEC EDGAR'], ['sec.gov', 'SEC EDGAR'],
  ['bls.gov', 'BLS'], ['bea.gov', 'BEA'], ['ecb.europa', 'ECB'],
  ['treasury.gov', 'US Treasury'], ['imf.org', 'IMF'],
  ['mof.gov.cn', '\u8d22\u653f\u90e8'], ['safe.gov.cn', '\u5916\u6c47\u7ba1\u7406\u5c40'],
  ['nfra.gov.cn', '\u91d1\u878d\u76d1\u7ba1\u603b\u5c40'],
  ['csrc.gov.cn', '\u8bc1\u76d1\u4f1a'],
  ['blog.google', 'Google AI Blog'], ['nvidianews', 'NVIDIA'],
  ['nhk.or.jp', 'NHK World'],
  ['rss.dw.com', 'Deutsche Welle'], ['dw.com', 'Deutsche Welle'],
  ['feeds.bbci.co.uk', 'BBC World'], ['bbc.com', 'BBC'],
  ['aljazeera.com', 'Al Jazeera'],
  ['france24.com', 'France 24'],
  ['people.com.cn', '\u4eba\u6c11\u65e5\u62a5'],
  ['news.cctv.com', '\u592e\u89c6\u7f51'], ['news.cn', '\u65b0\u534e\u793e'],
  ['tass.com', 'TASS'],
  ['yna.co.kr', 'Yonhap'], ['abc.net.au', 'ABC Australia'],
  ['cbc.ca', 'CBC'],
  ['apnews.com', 'AP News'], ['focustaiwan.tw', 'Focus Taiwan'],
  ['thehindu.com', 'The Hindu'], ['channelnewsasia', 'CNA'],
  ['aa.com.tr', 'Anadolu Agency'],
  ['boj.or.jp', 'BOJ'],
  ['consumerfinance.gov', 'CFPB'],
  ['iea.org', 'IEA'], ['eia.gov', 'EIA'],
  ['news.un.org', 'UN News'], ['who.int', 'WHO'],
  ['iaea.org', 'IAEA'], ['wto.org', 'WTO'],
  ['ec.europa.eu', 'EU Commission'],
  ['cftc.gov', 'CFTC'], ['ftc.gov', 'FTC'],  // cftc before ftc
  ['nato.int', 'NATO'],
]

export const formatSourceName = (name: string): string => {
  if (!name) return 'unknown'
  if (name.startsWith('support.claude')) {
    const slug = name.split('/').pop()?.replace(/^\d+-/, '') ?? 'support'
    return `Claude Support \u00b7 ${slug}`
  }
  for (const [match, display] of DISPLAY)
    if (name.includes(match)) return display
  const parts = name
    .replace(/\.(com|org|net|io|ai|dev)/, '')
    .split('/')
    .filter(p => !p.match(/\.(xml|json|atom|rss)$/))
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
  return `${Math.floor(hours / 24)}d ago`
}

// ── Format single feed item (unified for static and interactive) ──

const formatItem = (
  feedItem: FeedItem, maxWidth: number,
  opts?: { selected?: boolean; isNew?: boolean },
): string[] => {
  const color = sourceColor(feedItem.sourceName, feedItem.sourceType)
  const bg = opts?.selected ? SEL_COLOR : ''
  const badge = opts?.isNew ? ` ${NEW_BADGE}` : ''
  const ptr = opts?.selected ? `${color}\u25b6${RESET}` : `${color}\u250c\u2500${RESET}`
  const lines: string[] = []

  lines.push(`${bg} ${ptr} ${BOLD}${truncate(clean(feedItem.title), maxWidth - (opts?.isNew ? 6 : 0))}${RESET}${badge}`)
  if (feedItem.summary) {
    const cleaned = clean(feedItem.summary)
    if (cleaned) lines.push(`${bg} ${color}\u2502${RESET}  ${DIM}${truncate(cleaned, maxWidth)}${RESET}`)
  }
  const srcName = formatSourceName(feedItem.sourceName)
  lines.push(`${bg} ${color}\u2502${RESET}  ${color}${srcName}${RESET} ${GRAY}\u00b7 ${timeAgo(feedItem.publishedAt)}${RESET}`)
  lines.push(`${bg} ${color}\u2502${RESET}  ${DIM}\u2192 ${truncate(feedItem.url, maxWidth - 2)}${RESET}`)
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
  const maxWidth = cols() - 4
  for (const item of items) {
    for (const line of formatItem(item, maxWidth)) console.log(line)
  }
  if (olderCount > 0) {
    console.log(` ${GRAY}\u2500\u2500\u2500 ${olderCount} older items \u00b7 subscope --all${RESET}\n`)
  }
}

// ── Interactive browser ──

const SEEN_FILE = join(DIR, 'seen.json')

const loadSeen = (): Set<string> => {
  try {
    if (!existsSync(SEEN_FILE)) return new Set()
    return new Set(JSON.parse(readFileSync(SEEN_FILE, 'utf-8')))
  } catch { return new Set() }
}

const saveSeen = (seen: Set<string>) => {
  try { writeFileSync(SEEN_FILE, JSON.stringify([...seen].slice(-5000))) } catch {}
}

export const renderInteractive = (allItems: FeedItem[], olderCount = 0, hasSources = true): Promise<void> => {
  if (allItems.length === 0) {
    renderFeed(allItems, olderCount, hasSources)
    return Promise.resolve()
  }
  if (allItems.length <= 3) {
    console.log()
    const maxWidth = cols() - 4
    for (const i of allItems) for (const line of formatItem(i, maxWidth)) console.log(line)
    return Promise.resolve()
  }

  let cursor = 0
  let search = ''
  let items = allItems

  const seen = loadSeen()
  const newIds = new Set(allItems.filter(i => !seen.has(i.id)).map(i => i.id))
  for (const i of allItems) seen.add(i.id)
  saveSeen(seen)

  const applyFilter = () => {
    if (!search) { items = allItems; return }
    const q = search.toLowerCase()
    items = allItems.filter(i =>
      i.title.toLowerCase().includes(q) ||
      i.summary?.toLowerCase().includes(q) ||
      i.sourceName.toLowerCase().includes(q) ||
      i.url.toLowerCase().includes(q)
    )
  }

  const itemHeight = (feedItem: FeedItem) =>
    feedItem.summary && clean(feedItem.summary) ? 5 : 4

  const draw = () => {
    const maxWidth = cols() - 4
    const termH = rows()
    const lines: string[] = []

    // Search bar
    if (cursor === -1) {
      lines.push(`  ${c(36)}\u25b6${RESET} ${DIM}search:${RESET} ${search}\x1b[7m \x1b[27m`)
    } else if (search) {
      lines.push(`  ${DIM}search: ${search}${RESET}  ${GRAY}(${items.length} results)${RESET}`)
    } else {
      lines.push(`  ${DIM}/ search${RESET}`)
    }
    lines.push('')

    const headerH = 2
    const available = termH - headerH - 1

    if (items.length === 0) {
      lines.push(`  ${DIM}No results for "${search}"${RESET}`)
    } else {
      const effCursor = Math.max(0, cursor)

      // Scroll viewport
      let startIdx = 0, totalH = 0
      for (let i = 0; i < items.length; i++) {
        const ih = itemHeight(items[i]!)
        if (totalH + ih > available && i <= effCursor) { startIdx = i; totalH = 0 }
        totalH += ih
      }
      if (startIdx > effCursor) startIdx = effCursor

      for (let i = startIdx; i < items.length; i++) {
        const il = formatItem(items[i]!, maxWidth, {
          selected: i === effCursor && cursor >= 0,
          isNew: newIds.has(items[i]!.id),
        })
        if (lines.length - headerH + il.length > available) break
        lines.push(...il)
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

    const downloadPaper = async (feedItem: FeedItem) => {
      const pdfUrl = toPdfUrl(feedItem.url)
      if (!pdfUrl) return

      // Load auth cookies
      const authFile = join(DIR, 'auth.yml')
      let cookies = ''
      try {
        const auth = yamlParse(readFileSync(authFile, 'utf-8')) as any
        const domain = new URL(pdfUrl).hostname.replace('www.', '')
        cookies = auth?.[domain]?.cookies ?? auth?.academic?.cookies ?? ''
      } catch {}

      const dir = join(require('os').homedir(), 'Downloads', 'subscope')
      if (!existsSync(dir)) require('fs').mkdirSync(dir, { recursive: true })

      const safeName = feedItem.title.replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80)
      const filePath = join(dir, `${safeName}.pdf`)

      process.stdout.write(`\x1b[${rows() - 1};1H\x1b[K  ${DIM}Downloading...${RESET}`)

      try {
        const headers: Record<string, string> = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        if (cookies) headers['Cookie'] = cookies

        const res = await fetch(pdfUrl, { headers, redirect: 'follow' })
        if (!res.ok) throw new Error(`${res.status}`)

        const ct = res.headers.get('content-type') ?? ''
        if (!ct.includes('pdf') && !ct.includes('octet-stream')) {
          openUrl(pdfUrl)
          process.stdout.write(`\x1b[${rows() - 1};1H\x1b[K  ${DIM}Auth needed. Opened in browser.${RESET}`)
          setTimeout(draw, 1500)
          return
        }

        writeFileSync(filePath, Buffer.from(await res.arrayBuffer()))
        process.stdout.write(`\x1b[${rows() - 1};1H\x1b[K  ${DIM}Saved: ~/Downloads/subscope/${safeName}.pdf${RESET}`)
      } catch {
        openUrl(pdfUrl)
        process.stdout.write(`\x1b[${rows() - 1};1H\x1b[K  ${DIM}Opened in browser.${RESET}`)
      }
      setTimeout(draw, 2000)
    }

    const onKey = (key: string) => {
      if (key === '\x03' || key === 'q') { cleanup(); return }

      // Search box
      if (cursor === -1) {
        if (key === '\x1b[B') { cursor = items.length > 0 ? 0 : -1; draw(); return }
        if (key === '\r') { applyFilter(); cursor = items.length > 0 ? 0 : -1; draw(); return }
        if (key === '\x7f' || key === '\b') { search = search.slice(0, -1); applyFilter(); draw(); return }
        if (key.length === 1 && key.charCodeAt(0) >= 32) { search += key; applyFilter(); draw(); return }
        return
      }

      // Browse mode
      if (key === '\x1b[A' || key === 'k') {
        if (cursor > 0) { cursor--; newIds.delete(items[cursor]!.id); draw() }
        else { cursor = -1; draw() }
        return
      }
      if (key === '\x1b[B' || key === 'j') {
        if (cursor < items.length - 1) { cursor++; newIds.delete(items[cursor]!.id); draw() }
        return
      }
      if (key === '/') { cursor = -1; draw(); return }
      if (key === '\r') { openUrl(items[cursor]!.url); return }
      if (key === 'g') { downloadPaper(items[cursor]!); return }
    }

    process.stdin.on('data', onKey)
  })
}

// ── PDF URL resolver ──

const toPdfUrl = (url: string): string | null => {
  if (url.includes('nature.com/articles/')) return url + '.pdf'
  if (url.includes('arxiv.org/abs/')) return url.replace('/abs/', '/pdf/') + '.pdf'
  if (url.includes('science.org/doi/')) return url.replace('/doi/', '/doi/pdf/')
  if (url.includes('ieeexplore.ieee.org')) {
    const id = url.match(/document\/(\d+)/)?.[1]
    if (id) return `https://ieeexplore.ieee.org/stampPDF/getPDF.jsp?arnumber=${id}`
  }
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

  const printed = new Set<string>()
  console.log()

  for (const g of groups) {
    const parts = g.split('/')
    // Print parent nodes
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

    // Leaf group
    const depth = parts.length - 1
    const indent = '  '.repeat(depth)
    const leafName = parts[parts.length - 1]!
    const isActive = config.activeGroups.includes(g) || config.activeGroups.some(ag => g.startsWith(ag + '/'))
    const sample = config.sources.find(s => s.group === g)!
    const color = sourceColor(sample.name, sample.type, g)
    const sources = config.sources.filter(s => s.group === g)
    const activeCount = sources.filter(s => s.active !== false).length
    const icon = isActive ? `${color}\u25cf${RESET}` : `${GRAY}\u25cb${RESET}`
    const label = isActive ? `${BOLD}${leafName}${RESET}` : `${GRAY}${leafName}${RESET}`
    console.log(`${indent}  ${icon} ${label}  ${DIM}${activeCount}/${sources.length} sources${RESET}`)
  }

  console.log(`\n  ${DIM}subscope group <path> on/off${RESET}\n`)
}
