import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'airport-ground-ops:entries'
// 数据结构版本：字段或种子结构变了就 +1，旧缓存自动重播种，避免旧占位数据混进新视图。
const STORAGE_VERSION = 2

type StorageShape = { version: number; rows: Record<string, EntryRow[]> }

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function persist(rows: Record<string, EntryRow[]>): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    const payload: StorageShape = { version: STORAGE_VERSION, rows }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  }
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    persist(fallback)
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Partial<StorageShape>
    if (!parsed || parsed.version !== STORAGE_VERSION || !parsed.rows) {
      persist(fallback)
      return fallback
    }
    return { ...fallback, ...parsed.rows }
  } catch {
    persist(fallback)
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  persist(next)
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}
