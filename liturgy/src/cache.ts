// localStorage-backed cache for LotH hour content and per-day indexes.
//
// Liturgical content for a given date is stable, so entries have no TTL —
// they only get refreshed when the user hits the "Refresh all" button, which
// calls clearCache() to wipe everything.
//
// Key layout:
//   even.liturgy.cache.v1.<lang>.<date>.index        → HoursIndex JSON
//   even.liturgy.cache.v1.<lang>.<date>.<slug>       → HourContent JSON

import type { HoursIndex, HourContent, Language } from './types'

const PREFIX = 'even.liturgy.cache.v1'

function key(lang: Language, date: string, tail: string): string {
  return `${PREFIX}.${lang}.${date}.${tail}`
}

export function getCachedIndex(lang: Language, date: string): HoursIndex | null {
  return read<HoursIndex>(key(lang, date, 'index'))
}

export function putCachedIndex(lang: Language, date: string, idx: HoursIndex): void {
  write(key(lang, date, 'index'), idx)
}

export function getCachedHour(lang: Language, date: string, slug: string): HourContent | null {
  return read<HourContent>(key(lang, date, slug))
}

export function putCachedHour(lang: Language, date: string, slug: string, hour: HourContent): void {
  write(key(lang, date, slug), hour)
}

export function hasCachedHour(lang: Language, date: string, slug: string): boolean {
  return localStorage.getItem(key(lang, date, slug)) !== null
}

// Remove every cached entry (both languages, all dates). Used by "Refresh all".
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
