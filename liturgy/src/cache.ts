// localStorage-backed cache for LotH hour content and per-day indexes.
//
// Liturgical content for a given date is stable, so entries have no TTL —
// they only get refreshed when the user hits the "Refresh all" button, which
// calls clearCache() to wipe everything.
//
// Key layout:
//   even.liturgy.cache.v2.<breviaryId>.<date>.index   → HoursIndex JSON
//   even.liturgy.cache.v2.<breviaryId>.<date>.<slug>  → HourContent JSON

import type { HoursIndex, HourContent } from './types'

const PREFIX = 'even.liturgy.cache.v2'

function key(breviaryId: string, date: string, tail: string): string {
  return `${PREFIX}.${breviaryId}.${date}.${tail}`
}

export function getCachedIndex(breviaryId: string, date: string): HoursIndex | null {
  return read<HoursIndex>(key(breviaryId, date, 'index'))
}

export function putCachedIndex(breviaryId: string, date: string, idx: HoursIndex): void {
  write(key(breviaryId, date, 'index'), idx)
}

export function getCachedHour(breviaryId: string, date: string, slug: string): HourContent | null {
  return read<HourContent>(key(breviaryId, date, slug))
}

export function putCachedHour(breviaryId: string, date: string, slug: string, hour: HourContent): void {
  write(key(breviaryId, date, slug), hour)
}

export function hasCachedHour(breviaryId: string, date: string, slug: string): boolean {
  return localStorage.getItem(key(breviaryId, date, slug)) !== null
}

// Remove every cached entry (all breviaries, all dates). Used by "Refresh all".
export function clearCache(): void {
  const toDelete: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k && k.startsWith(PREFIX + '.')) toDelete.push(k)
  }
  for (const k of toDelete) localStorage.removeItem(k)
}

export function cacheStats(): { entries: number; approxBytes: number } {
  let entries = 0
  let bytes = 0
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (!k || !k.startsWith(PREFIX + '.')) continue
    entries++
    const v = localStorage.getItem(k)
    if (v) bytes += k.length + v.length
  }
  return { entries, approxBytes: bytes * 2 } // rough: UTF-16 in JS strings
}

function read<T>(k: string): T | null {
  try {
    const raw = localStorage.getItem(k)
    if (!raw) return null
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function write(k: string, value: unknown): void {
  try {
    localStorage.setItem(k, JSON.stringify(value))
  } catch (err) {
    // Quota exceeded or storage disabled — fail silently; next fetch will retry.
    console.warn('Cache write failed', k, err)
  }
}
