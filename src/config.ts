import { parse, stringify } from 'yaml'
import { join } from 'path'
import { homedir } from 'os'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs'
import type { Source } from './types.ts'

export interface Config {
  activeGroups: string[]
  sources: Source[]
}

const SUBSCOPE_DIR = join(homedir(), '.subscope')
const CONFIG_FILE = join(SUBSCOPE_DIR, 'config.yml')

const ensureDir = () => {
  if (!existsSync(SUBSCOPE_DIR)) mkdirSync(SUBSCOPE_DIR, { recursive: true })
}

export const load = (): Config => {
  ensureDir()
  if (!existsSync(CONFIG_FILE)) return { activeGroups: [], sources: [] }
  const raw = parse(readFileSync(CONFIG_FILE, 'utf-8')) as any
  // Migrate: old configs without group/active/activeGroups
  const sources: Source[] = (raw?.sources ?? []).map((s: any) => ({
    ...s,
    group: s.group ?? inferGroup(s.url),
    active: s.active ?? true,
  }))
  const groups = [...new Set(sources.map(s => s.group))]
  const activeGroups: string[] = raw?.activeGroups ?? groups
  return { activeGroups, sources }
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
  const { hostname } = new URL(url)
  if (hostname.includes('anthropic.com')) return 'anthropic'
  if (hostname.includes('claude')) return 'claude'
  return hostname.replace('www.', '').split('.')[0]!
}

// Get sources that should be fetched/displayed
export const activeSources = (config: Config, group?: string): Source[] => {
  return config.sources.filter(s => {
    if (!s.active) return false
    if (group) return s.group === group
    return config.activeGroups.includes(s.group)
  })
}
