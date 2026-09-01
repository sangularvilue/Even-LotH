/**
 * Where the sun is.
 *
 * SDK 0.0.14 added phone location to the bridge, which lets the app stop
 * guessing. Two things fall out of a latitude and a longitude:
 *
 *  1. The **real** solar day — sunrise, solar noon and sunset for today, here.
 *  2. Which hour of the office you most likely opened the app to pray.
 *
 * The second is the interesting one. The little hours are not clock times; they
 * are the third, sixth and ninth hours of a day whose twelve hours run from
 * sunrise to sunset and stretch or shrink with the season. Before this SDK
 * there was no way for the plugin to know where sunrise was, so the hour list
 * always opened on the first entry. Now it can open on the right one.
 */

import { AppLocationAccuracy, type EvenAppBridge } from '@evenrealities/even_hub_sdk'
import type { HourInfo } from './types'

export type Coords = { latitude: number; longitude: number }

export type SolarDay = {
  sunrise: Date
  solarNoon: Date
  sunset: Date
  /** True at latitudes/seasons where the sun does not rise or set today. */
  degenerate: boolean
}

const COORDS_KEY = 'even.liturgy.coords.v1'
const COORDS_TTL_MS = 12 * 60 * 60 * 1000 // a day's worth of sun is fine for half a day
const LOCATION_TIMEOUT_MS = 6000

// ── Coordinates ──

function readCachedCoords(): { coords: Coords; at: number } | null {
  try {
    const raw = localStorage.getItem(COORDS_KEY)
    if (!raw) return null
    const o = JSON.parse(raw)
    if (typeof o?.latitude !== 'number' || typeof o?.longitude !== 'number') return null
    return { coords: { latitude: o.latitude, longitude: o.longitude }, at: Number(o.at) || 0 }
  } catch {
    return null
  }
}

function writeCachedCoords(coords: Coords): void {
  try {
    localStorage.setItem(COORDS_KEY, JSON.stringify({ ...coords, at: Date.now() }))
  } catch { /* private mode / quota — solar times just fall back to the clock */ }
}

/**
 * Best-effort coordinates. Returns a cached fix immediately when it is still
 * fresh; otherwise asks the phone once, at low accuracy — a few kilometres is
 * far more precision than sunset needs, and it costs almost no battery.
 *
 * Never throws and never blocks the reading path: a null result simply means
 * the app keeps using clock times.
 */
export async function getCoords(bridge: EvenAppBridge | null, log?: (s: string) => void): Promise<Coords | null> {
  const cached = readCachedCoords()
  if (cached && Date.now() - cached.at < COORDS_TTL_MS) return cached.coords

  if (!bridge || typeof (bridge as any).getAppLocation !== 'function') {
    log?.('Location unavailable in this SDK/host — using clock times')
    return cached?.coords ?? null
  }

  try {
    const fix = await Promise.race([
      bridge.getAppLocation({ accuracy: AppLocationAccuracy.Low, timeoutMs: LOCATION_TIMEOUT_MS }),
      new Promise<null>(resolve => window.setTimeout(() => resolve(null), LOCATION_TIMEOUT_MS + 500)),
    ])
    if (fix && typeof fix.latitude === 'number' && typeof fix.longitude === 'number') {
      const coords = { latitude: fix.latitude, longitude: fix.longitude }
      writeCachedCoords(coords)
      log?.(`Location: ${coords.latitude.toFixed(2)}, ${coords.longitude.toFixed(2)}`)
      return coords
    }
    log?.('Location denied or timed out — using clock times')
  } catch (err) {
    log?.(`Location error: ${err}`)
  }
  return cached?.coords ?? null
}

// ── Solar times (NOAA general solar position) ──

const RAD = Math.PI / 180

function dayOfYear(d: Date): number {
  const start = Date.UTC(d.getUTCFullYear(), 0, 1)
  const today = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  return Math.floor((today - start) / 86400000) + 1
}

/** Minutes-past-UTC-midnight → a Date on the same local calendar day as `ref`. */
function utcMinutesToDate(ref: Date, minutes: number): Date {
  const base = Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate())
  return new Date(base + minutes * 60000)
}

/**
 * Sunrise, solar noon and sunset for a location on a given date.
 *
 * NOAA's general solar position algorithm — accurate to well under a minute at
 * temperate latitudes, which is far better than this app needs. `degenerate` is
 * set when the sun neither rises nor sets (polar summer/winter); callers fall
 * back to clock times in that case.
 */
export function solarDay(coords: Coords, when: Date = new Date()): SolarDay {
  const { latitude: lat, longitude: lon } = coords
  const n = dayOfYear(when)

  // Fractional year, evaluated at local solar midday for stability.
  const gamma = (2 * Math.PI / 365) * (n - 1)

  const eqTime = 229.18 * (
    0.000075
    + 0.001868 * Math.cos(gamma)
    - 0.032077 * Math.sin(gamma)
    - 0.014615 * Math.cos(2 * gamma)
    - 0.040849 * Math.sin(2 * gamma)
  )

  const decl =
    0.006918
    - 0.399912 * Math.cos(gamma)
    + 0.070257 * Math.sin(gamma)
    - 0.006758 * Math.cos(2 * gamma)
    + 0.000907 * Math.sin(2 * gamma)
    - 0.002697 * Math.cos(3 * gamma)
    + 0.001480 * Math.sin(3 * gamma)

  const solarNoonMin = 720 - 4 * lon - eqTime

  // Hour angle of sunrise, using the standard 90.833° zenith (refraction + disc).
  const cosH =
    Math.cos(90.833 * RAD) / (Math.cos(lat * RAD) * Math.cos(decl))
    - Math.tan(lat * RAD) * Math.tan(decl)

  const degenerate = cosH > 1 || cosH < -1
  const haDeg = degenerate ? 90 : Math.acos(cosH) / RAD

  return {
    sunrise: utcMinutesToDate(when, solarNoonMin - 4 * haDeg),
    solarNoon: utcMinutesToDate(when, solarNoonMin),
    sunset: utcMinutesToDate(when, solarNoonMin + 4 * haDeg),
    degenerate,
  }
}

// ── Which hour is it? ──

type HourKind =
  | 'invitatory'
  | 'readings'
  | 'lauds'
  | 'terce'
  | 'sext'
  | 'none'
  | 'vespers'
  | 'compline'

/**
 * Classify an hour by name across all three breviaries (English Divine Office,
 * Italian CEI, Ordinariate). Matching on names rather than slugs keeps this
 * working when a source changes its URL scheme.
 */
function classifyHour(name: string): HourKind | null {
  const n = (name || '').toLowerCase()
  if (/yesterday|di ieri/.test(n)) return null // never auto-open a back-dated office
  if (/invitator/.test(n)) return 'invitatory'
  if (/office of readings|ufficio delle letture|mattins|matins/.test(n)) return 'readings'
  if (/morning prayer|lodi|lauds/.test(n)) return 'lauds'
  if (/midmorning|terza|terce|prime/.test(n)) return 'terce'
  if (/midday|sesta|sext/.test(n)) return 'sext'
  if (/midafternoon|nona|none/.test(n)) return 'none'
  if (/evening prayer|vespri|vespers|evensong/.test(n)) return 'vespers'
  if (/night prayer|compieta|compline/.test(n)) return 'compline'
  return null
}

/**
 * The moment each hour is "due", in ms since epoch.
 *
 * With coordinates, the little hours land on the third, sixth and ninth of the
 * twelve unequal hours between sunrise and sunset — the reckoning the office was
 * written for. Without coordinates, fixed clock times stand in.
 */
function anchorTimes(solar: SolarDay | null, now: Date): Record<HourKind, number> {
  if (!solar || solar.degenerate) {
    const at = (h: number, m = 0) => {
      const d = new Date(now)
      d.setHours(h, m, 0, 0)
      return d.getTime()
    }
    return {
      invitatory: at(5, 30),
      readings: at(6),
      lauds: at(7),
      terce: at(9),
      sext: at(12),
      none: at(15),
      vespers: at(18),
      compline: at(21),
    }
  }

  const rise = solar.sunrise.getTime()
  const set = solar.sunset.getTime()
  const daylight = set - rise
  const hour = daylight / 12 // one unequal hour

  return {
    invitatory: rise - 90 * 60000,
    readings: rise - 60 * 60000,
    lauds: rise,
    terce: rise + 3 * hour,
    sext: rise + 6 * hour,
    none: rise + 9 * hour,
    vespers: set,
    compline: set + 90 * 60000,
  }
}

/**
 * Index into `hours` of the office most likely wanted right now: the latest one
 * whose due time has passed. Before the first anchor of the day (the small hours
 * of the night) this returns Compline, which is what you want at 1 a.m.
 *
 * Returns 0 when nothing in the list can be classified.
 */
export function suggestHourIndex(hours: HourInfo[], solar: SolarDay | null, now: Date = new Date()): number {
  const anchors = anchorTimes(solar, now)
  const t = now.getTime()

  let best = -1
  let bestAnchor = -Infinity
  let earliest = -1
  let earliestAnchor = Infinity
  let latest = -1
  let latestAnchor = -Infinity

  hours.forEach((h, i) => {
    const kind = classifyHour(h.name)
    if (!kind) return
    const anchor = anchors[kind]
    if (anchor < earliestAnchor) { earliestAnchor = anchor; earliest = i }
    if (anchor > latestAnchor) { latestAnchor = anchor; latest = i }
    if (anchor <= t && anchor > bestAnchor) { bestAnchor = anchor; best = i }
  })

  if (best >= 0) return best
  // Before the day's first hour — we are in the night, so the last office stands.
  if (latest >= 0) return latest
  return earliest >= 0 ? earliest : 0
}

/** `06:12` in the user's local time, for the companion panel and the log. */
export function clockLabel(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
