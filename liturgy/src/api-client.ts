import type { HoursIndex, HourContent, Language } from './types'
import { getLanguage } from './settings'
import { getCachedIndex, putCachedIndex, getCachedHour, putCachedHour, hasCachedHour } from './cache'

// When running from .ehpk (no local API), use the Vercel deployment.
// When running from loth.grannis.xyz, use relative URLs.
const isLocalFile = window.location.protocol === 'file:' || !window.location.host.includes('grannis')
const SERVER_URL = isLocalFile ? 'https://loth.grannis.xyz' : ''

function endpointForLang(lang: Language): { list: string; hour: (slug: string, date: string) => string } {
  if (lang === 'it') {
    return {
      list: `${SERVER_URL}/api/hours_it`,
      hour: (slug, date) => `${SERVER_URL}/api/hour_it?slug=${encodeURIComponent(slug)}&date=${date}`,
    }
  }
  return {
    list: `${SERVER_URL}/api/hours`,
    hour: (slug, date) => `${SERVER_URL}/api/hour/${slug}?date=${date}`,
  }
}

// date format: YYYYMMDD
export async function fetchHours(date: string, lang: Language = getLanguage()): Promise<HoursIndex> {
  const cached = getCachedIndex(lang, date)
  if (cached) return cached

  const ep = endpointForLang(lang)
  const tzOffset = new Date().getTimezoneOffset()
  const res = await fetch(`${ep.list}?date=${date}&tz=${tzOffset}`)
  if (!res.ok) throw new Error(`Server error: ${res.status}`)
  const idx = await res.json() as HoursIndex
  putCachedIndex(lang, date, idx)
  return idx
}

export async function fetchHour(slug: string, date: string, lang: Language = getLanguage()): Promise<HourContent> {
  const cached = getCachedHour(lang, date, slug)
  if (cached) return cached

  const ep = endpointForLang(lang)
  const res = await fetch(ep.hour(slug, date))
  if (!res.ok) throw new Error(`Server error: ${res.status}`)
  const hour = await res.json() as HourContent
  putCachedHour(lang, date, slug, hour)
  return hour
}

export async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${SERVER_URL}/api/health`)
    const data = await res.json()
    return data.ok === true
  } catch {
    return false
  }
}

// ── Bulk prefetch for the next week ──

export type PrefetchProgress = {
  done: number
  total: number
  failed: number
  currentLabel?: string
}

// Fetch all hours for today + the next `days-1` days. Skips anything already
// cached. Calls onProgress after every individual fetch (or cache hit).
export async function prefetchWeek(
  dates: string[],
  lang: Language = getLanguage(),
  onProgress?: (p: PrefetchProgress) => void,
): Promise<PrefetchProgress> {
  // First, get the hour list for each day (sequentially so we report real progress)
  const allTasks: { date: string; slug: string; name: string }[] = []
  let done = 0
  let failed = 0
  const countListSteps = dates.length
  // (We emit initial progress so the UI can render 0 / N immediately)
  const totalInitial = countListSteps // will grow once indexes load
  onProgress?.({ done: 0, total: totalInitial, failed: 0, currentLabel: 'Loading day index…' })

  for (const date of dates) {
    try {
      const idx = await fetchHours(date, lang)
      for (const h of idx.hours) {
        allTasks.push({ date: (h as any).date || date, slug: h.slug, name: h.name })
      }
    } catch (err) {
      console.warn('Index fetch failed', date, err)
      failed++
    }
    done++
    onProgress?.({ done, total: countListSteps + allTasks.length, failed, currentLabel: `Index ${date}` })
  }

  const total = countListSteps + allTasks.length

  // Then fetch each hour's content, skipping cached
  for (const t of allTasks) {
    const hourDate = t.date || ''
    if (hasCachedHour(lang, hourDate, t.slug)) {
      done++
      onProgress?.({ done, total, failed, currentLabel: `${t.name} (cached)` })
      continue
    }
    try {
      await fetchHour(t.slug, hourDate, lang)
    } catch (err) {
      console.warn('Hour fetch failed', t.slug, hourDate, err)
      failed++
    }
    done++
    onProgress?.({ done, total, failed, currentLabel: t.name })
  }

  return { done, total, failed }
}

// Helper: build the next-N-days date list in compact (YYYYMMDD) format.
export function nextNDates(n: number, startDate?: Date): string[] {
  const start = startDate ?? new Date()
  const out: string[] = []
  for (let i = 0; i < n; i++) {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    out.push(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`)
  }
  return out
}
