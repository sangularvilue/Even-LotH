import type { HoursIndex, HourContent } from './types'

const SERVER_URL = ''

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
