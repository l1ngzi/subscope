import { parse, stringify } from 'yaml'
import { join } from 'path'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs'
import { DIR, groupMatches, sourceId } from './lib.ts'
import { SOURCE_REGISTRY } from './sources.ts'
import { detectType } from './adapters/index.ts'
import type { Source } from './types.ts'

export type ModeName = 'formal' | 'quick' | string

export interface ModeConfig {
  types?: string[]
  groups?: string[]
}

export interface Config {
  activeGroups: string[]
  folders: string[]
  defaultMode: ModeName
  modes: Record<string, ModeConfig>
  sources: Source[]
}

const DEFAULT_MODES: Record<string, ModeConfig> = {
  formal: { types: ['website'], groups: ['ai'] },
  quick: { types: ['youtube', 'twitter'] },
  eco: { groups: ['econ'] },
  glob: { groups: ['news'] },
}

const CONFIG_FILE = join(DIR, 'config.yml')

const ensureDir = () => {
  if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true })
}

// Build sources from hardcoded registry, overlay active state from config
const buildSources = (savedStates?: Record<string, boolean>): Source[] => {
  return SOURCE_REGISTRY.map(def => {
    const id = sourceId(def.url)
    const parsed = new URL(def.url)
    const host = parsed.hostname.replace('www.', '')
    const path = parsed.pathname.replace(/\/+$/, '')
    const name = path && path !== '/' ? `${host}${path}` : host
    const type = def.type ?? detectType(def.url)
    const active = savedStates?.[id] ?? true
    return { id, url: def.url, type, name, group: def.group, active, addedAt: '' }
  })
}

export const load = (): Config => {
  ensureDir()
  const raw = existsSync(CONFIG_FILE) ? parse(readFileSync(CONFIG_FILE, 'utf-8')) as any : null

  // Restore per-source active states
  const savedStates: Record<string, boolean> = {}
  for (const s of (raw?.sources ?? []) as any[])
    if (s.id && s.active !== undefined) savedStates[s.id] = s.active

  const sources = buildSources(savedStates)
  const allGroups = [...new Set(sources.map(s => s.group))]
  const activeGroups: string[] = raw?.activeGroups ?? allGroups

  // Folders: all group paths + parents
  const allPaths = new Set([...allGroups, ...activeGroups, ...((raw?.folders ?? []) as string[])])
  for (const p of [...allPaths]) {
    const parts = p.split('/')
    for (let i = 1; i < parts.length; i++) allPaths.add(parts.slice(0, i).join('/'))
  }

  const defaultMode: ModeName = raw?.defaultMode ?? 'formal'
  const customModes = (raw?.modes ?? {}) as Record<string, ModeConfig>
  const modes: Record<string, ModeConfig> = { ...DEFAULT_MODES }
  for (const [name, cfg] of Object.entries(customModes))
    if (!(name in DEFAULT_MODES)) modes[name] = cfg

  return { activeGroups, folders: [...allPaths].sort(), defaultMode, modes, sources }
}

export const save = (config: Config): void => {
  ensureDir()
  const customModes: Record<string, ModeConfig> = {}
  for (const [name, cfg] of Object.entries(config.modes))
    if (!(name in DEFAULT_MODES)) customModes[name] = cfg
  // Only save user preferences: active states, activeGroups, defaultMode
  const sourceStates = config.sources
    .filter(s => !s.active) // only save disabled sources (active=true is default)
    .map(s => ({ id: s.id, active: false }))
  writeFileSync(CONFIG_FILE, stringify({
    activeGroups: config.activeGroups,
    defaultMode: config.defaultMode,
    folders: config.folders,
    sources: sourceStates.length ? sourceStates : undefined,
    modes: Object.keys(customModes).length ? customModes : undefined,
  }))
}

// Get sources that should be fetched/displayed
export const activeSources = (config: Config, opts?: { group?: string; mode?: string }): Source[] => {
  const mode = opts?.mode
  const modeConfig = mode ? config.modes[mode] : undefined

  return config.sources.filter(s => {
    if (!s.active) return false
    if (opts?.group) return groupMatches(s.group, opts.group)
    if (!config.activeGroups.some(g => groupMatches(s.group, g))) return false
    if (modeConfig) {
      if (modeConfig.types && !modeConfig.types.includes(s.type)) return false
      if (modeConfig.groups && !modeConfig.groups.some(g => groupMatches(s.group, g))) return false
      return true
    }
    return true
  })
}
