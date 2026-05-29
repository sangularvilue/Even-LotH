// Liturgical season derivation for the "Illumination" UI theming.
//
// Season drives the app's ACCENT + MOTIF only; the season's display *name*
// comes from the active breviary's locale (see STRINGS in main.ts). This is a
// civil-date computation (offline, deterministic) — intentionally independent
// of any breviary's own calendar so theming is consistent across editions.

export type SeasonId = 'advent' | 'christmas' | 'ordinary' | 'lent' | 'easter' | 'pentecost'

export type SeasonInfo = {
  season: SeasonId
  adventWeek: number // 1–4 during Advent, else 0
}

export type SeasonStyle = {
  band: string
  bandDeep: string
  rose?: string
  motif: 'advent' | 'hero' | 'fleuron' | 'none'
  austere?: boolean // Lent → brutalist layout
  alleluia?: boolean
}

// Exact tokens from the design handoff (§Color — season accent).
export const SEASON_STYLE: Record<SeasonId, SeasonStyle> = {
  advent: { band: '#4a3a7c', bandDeep: '#33285f', rose: '#c98ab0', motif: 'advent' },
  christmas: { band: '#bf9a34', bandDeep: '#8f6f16', motif: 'hero' },
  ordinary: { band: '#3f6e52', bandDeep: '#2c5640', motif: 'fleuron' },
  lent: { band: '#5a4a86', bandDeep: '#3f3163', motif: 'none', austere: true },
  easter: { band: '#c9a23a', bandDeep: '#a07c1c', motif: 'hero', alleluia: true },
  pentecost: { band: '#9c2f2f', bandDeep: '#7a2020', motif: 'hero' },
}

// ── date helpers (work in local time, date-only) ──
function ymd(y: number, m: number, d: number): Date { return new Date(y, m - 1, d) }
function addDays(date: Date, n: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + n)
  return d
}
function daysBetween(a: Date, b: Date): number {
  const ms = ymd(a.getFullYear(), a.getMonth() + 1, a.getDate()).getTime()
    - ymd(b.getFullYear(), b.getMonth() + 1, b.getDate()).getTime()
  return Math.round(ms / 86400000)
}

// Anonymous Gregorian computus → Easter Sunday for a given year.
export function easterSunday(year: number): Date {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31) // 3 = March, 4 = April
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return ymd(year, month, day)
}

// First Sunday of Advent for a given year (4th Sunday before 25 Dec).
function adventStart(year: number): Date {
  const christmas = ymd(year, 12, 25)
  const dow = christmas.getDay() // 0 = Sunday
  const lastAdventSunday = addDays(christmas, -(dow === 0 ? 7 : dow)) // Sunday before Christmas = Advent IV
  return addDays(lastAdventSunday, -21) // back to Advent I
}

export function getLiturgicalSeason(date: Date = new Date()): SeasonInfo {
  const y = date.getFullYear()
  const easter = easterSunday(y)
  const ashWednesday = addDays(easter, -46)
  const pentecost = addDays(easter, 49)

  // Lent: Ash Wednesday through Holy Saturday (theming runs up to Easter eve).
  if (date >= ashWednesday && date < easter) return { season: 'lent', adventWeek: 0 }
  // Eastertide: Easter Sunday up to (but not incl.) Pentecost.
  if (date >= easter && date < pentecost) return { season: 'easter', adventWeek: 0 }
  // Pentecost: its week.
  if (date >= pentecost && date <= addDays(pentecost, 6)) return { season: 'pentecost', adventWeek: 0 }

  // Advent: Advent I … 24 Dec.
  const advent1 = adventStart(y)
  if (date >= advent1 && date <= ymd(y, 12, 24)) {
    const week = Math.min(4, Math.floor(daysBetween(date, advent1) / 7) + 1)
    return { season: 'advent', adventWeek: Math.max(1, week) }
  }
  // Christmastide: 25–31 Dec, or 1 Jan … Epiphany (6 Jan).
  if ((date.getMonth() === 11 && date.getDate() >= 25) || (date.getMonth() === 0 && date.getDate() <= 6)) {
    return { season: 'christmas', adventWeek: 0 }
  }
  return { season: 'ordinary', adventWeek: 0 }
}
