import { parse, stringify } from 'yaml'
import { join } from 'path'
import { homedir } from 'os'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs'
import type { Source } from './types.ts'

export type ModeName = 'formal' | 'quick' | string

export interface ModeConfig {
  types?: string[]   // source types to include
  groups?: string[]  // source group prefixes to include
}

export interface Config {
  activeGroups: string[]
  folders: string[]      // all created folder paths (persists even when empty/inactive)
  defaultMode: ModeName
  modes: Record<string, ModeConfig>
  sources: Source[]
}

const DEFAULT_MODES: Record<string, ModeConfig> = {
  formal: { types: ['website'] },
  quick: { types: ['youtube', 'twitter'] },
  eco: { groups: ['econ'] },
}

const SUBSCOPE_DIR = join(homedir(), '.subscope')
const CONFIG_FILE = join(SUBSCOPE_DIR, 'config.yml')

const ensureDir = () => {
  if (!existsSync(SUBSCOPE_DIR)) mkdirSync(SUBSCOPE_DIR, { recursive: true })
}

export const load = (): Config => {
  ensureDir()
  if (!existsSync(CONFIG_FILE)) return { activeGroups: [], folders: [], defaultMode: 'formal', modes: DEFAULT_MODES, sources: [] }
  const raw = parse(readFileSync(CONFIG_FILE, 'utf-8')) as any
  // Migrate: old configs + flat groups → nested groups
  const migrateGroup = (g: string) => {
    if (g.includes('/')) return g // already nested
    const map: Record<string, string> = {
      anthropic: 'ai/anthropic', claude: 'ai/claude', openai: 'ai/openai',
      deepmind: 'ai/deepmind', deepseek: 'ai/deepseek', xai: 'ai/xai',
    }
    return map[g] ?? g
  }
  const sources: Source[] = (raw?.sources ?? []).map((s: any) => ({
    ...s,
    group: migrateGroup(s.group ?? inferGroup(s.url)),
    active: s.active ?? true,
  }))
  const rawGroups: string[] = raw?.activeGroups ?? [...new Set(sources.map(s => s.group))]
  const activeGroups = rawGroups.map(migrateGroup)
  // Folders: all unique group paths (from sources + activeGroups + explicit folders)
  const allPaths = new Set([
    ...sources.map(s => s.group),
    ...activeGroups,
    ...((raw?.folders ?? []) as string[]).map(migrateGroup),
  ])
  // Also add parent paths (e.g. "ai" from "ai/anthropic")
  for (const p of [...allPaths]) {
    const parts = p.split('/')
    for (let i = 1; i < parts.length; i++) {
      allPaths.add(parts.slice(0, i).join('/'))
    }
  }
  const folders = [...allPaths].sort()
  const defaultMode: ModeName = raw?.defaultMode ?? 'formal'
  const modes: Record<string, ModeConfig> = raw?.modes ?? DEFAULT_MODES
  return { activeGroups, folders, defaultMode, modes, sources }
}

export const save = (config: Config): void => {
  ensureDir()
  writeFileSync(CONFIG_FILE, stringify(config))
}

export const addSource = (config: Config, source: Source): Config => {
  const sources = [...config.sources, source]
  const activeGroups = config.activeGroups.includes(source.group)
    ? config.activeGroups
    : [...config.activeGroups, source.group]
  return { ...config, activeGroups, sources }
}

export const removeSource = (config: Config, id: string): Config => ({
  ...config,
  sources: config.sources.filter(s => s.id !== id),
})

// Auto-infer group from URL hostname
export const inferGroup = (url: string): string => {
  const { hostname, pathname } = new URL(url)
  // YouTube / X / GitHub: infer from handle/org
  if (hostname.includes('youtube.com') || hostname.includes('twitter.com') || hostname.includes('x.com') || hostname === 'github.com') {
    const handle = pathname.match(/@?([\w-]+)/)?.[1]?.toLowerCase() ?? ''
    if (handle.includes('anthropic')) return 'ai/anthropic'
    if (handle.includes('claude')) return 'ai/claude'
    if (handle.includes('deepseek')) return 'ai/deepseek'
    if (handle.includes('openai')) return 'ai/openai'
    if (handle.includes('deepmind')) return 'ai/deepmind'
    if (handle.includes('xai') || handle.includes('grok')) return 'ai/xai'
    return handle || hostname.split('.')[0]!
  }
  if (hostname.includes('anthropic.com')) return 'ai/anthropic'
  if (hostname.includes('claude')) return 'ai/claude'
  if (hostname.includes('deepseek')) return 'ai/deepseek'
  if (hostname.includes('openai.com')) return 'ai/openai'
  if (hostname.includes('deepmind')) return 'ai/deepmind'
  if (hostname === 'x.ai') return 'ai/xai'
  // Economics & Finance
  if (hostname.includes('federalreserve.gov')) return 'econ/fed'
  if (hostname.includes('pbc.gov.cn')) return 'econ/pboc'
  if (hostname.includes('stats.gov.cn')) return 'econ/nbs'
  if (hostname.includes('sec.gov')) return 'econ/sec'
  if (hostname.includes('bls.gov')) return 'econ/bls'
  if (hostname.includes('bea.gov')) return 'econ/bea'
  return hostname.replace('www.', '').split('.')[0]!
}

// Get sources that should be fetched/displayed
export const activeSources = (config: Config, opts?: { group?: string; mode?: string }): Source[] => {
  const mode = opts?.mode
  const modeConfig = mode ? config.modes[mode] : undefined

  return config.sources.filter(s => {
    if (!s.active) return false
    if (opts?.group) return s.group === opts.group || s.group.startsWith(opts.group + '/')
    if (!config.activeGroups.some(g => s.group === g || s.group.startsWith(g + '/'))) return false
    if (modeConfig) {
      if (modeConfig.types && !modeConfig.types.includes(s.type)) return false
      if (modeConfig.groups && !modeConfig.groups.some(g => s.group === g || s.group.startsWith(g + '/'))) return false
      return true
    }
    return true
  })
}
