import { parse, stringify } from 'yaml'
import { join } from 'path'
import { homedir } from 'os'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs'
import type { Source } from './types.ts'

export type ModeName = 'formal' | 'quick' | string

export interface ModeConfig {
  types: string[]  // source types to include
}

export interface Config {
  activeGroups: string[]
  defaultMode: ModeName
  modes: Record<string, ModeConfig>
  sources: Source[]
}

const DEFAULT_MODES: Record<string, ModeConfig> = {
  formal: { types: ['website'] },
  quick: { types: ['youtube', 'twitter'] },
}

const SUBSCOPE_DIR = join(homedir(), '.subscope')
const CONFIG_FILE = join(SUBSCOPE_DIR, 'config.yml')

const ensureDir = () => {
  if (!existsSync(SUBSCOPE_DIR)) mkdirSync(SUBSCOPE_DIR, { recursive: true })
}

export const load = (): Config => {
  ensureDir()
  if (!existsSync(CONFIG_FILE)) return { activeGroups: [], defaultMode: 'formal', modes: DEFAULT_MODES, sources: [] }
  const raw = parse(readFileSync(CONFIG_FILE, 'utf-8')) as any
  // Migrate: old configs without group/active/activeGroups/modes
  const sources: Source[] = (raw?.sources ?? []).map((s: any) => ({
    ...s,
    group: s.group ?? inferGroup(s.url),
    active: s.active ?? true,
  }))
  const groups = [...new Set(sources.map(s => s.group))]
  const activeGroups: string[] = raw?.activeGroups ?? groups
  const defaultMode: ModeName = raw?.defaultMode ?? 'formal'
  const modes: Record<string, ModeConfig> = raw?.modes ?? DEFAULT_MODES
  return { activeGroups, defaultMode, modes, sources }
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
    if (handle.includes('anthropic')) return 'anthropic'
    if (handle.includes('claude')) return 'claude'
    if (handle.includes('deepseek')) return 'deepseek'
    return handle || hostname.split('.')[0]!
  }
  if (hostname.includes('anthropic.com')) return 'anthropic'
  if (hostname.includes('claude')) return 'claude'
  if (hostname.includes('deepseek')) return 'deepseek'
  return hostname.replace('www.', '').split('.')[0]!
}

// Get sources that should be fetched/displayed
export const activeSources = (config: Config, opts?: { group?: string; mode?: string }): Source[] => {
  const mode = opts?.mode
  const modeConfig = mode ? config.modes[mode] : undefined

  return config.sources.filter(s => {
    if (!s.active) return false
    if (opts?.group) return s.group === opts.group
    if (!config.activeGroups.includes(s.group)) return false
    if (modeConfig) return modeConfig.types.includes(s.type)
    return true
  })
}
