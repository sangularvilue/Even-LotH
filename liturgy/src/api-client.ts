import type { HoursIndex, HourContent } from './types'

// When running from .ehpk (no local API), use the Vercel deployment.
// When running from loth.grannis.xyz, use relative URLs.
const isLocalFile = window.location.protocol === 'file:' || !window.location.host.includes('grannis')
const SERVER_URL = isLocalFile ? 'https://loth.grannis.xyz' : ''

export async function fetchHours(date: string): Promise<HoursIndex> {
  // Send timezone offset so the API can adjust for UTC vs local
  const tzOffset = new Date().getTimezoneOffset()
  const res = await fetch(`${SERVER_URL}/api/hours?date=${date}&tz=${tzOffset}`)
  if (!res.ok) throw new Error(`Server error: ${res.status}`)
  return res.json()
}

export async function fetchHour(slug: string, date: string): Promise<HourContent> {
  const res = await fetch(`${SERVER_URL}/api/hour/${slug}?date=${date}`)
  if (!res.ok) throw new Error(`Server error: ${res.status}`)
  return res.json()
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
