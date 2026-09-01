export type HourInfo = {
  slug: string
  name: string
  date?: string
}

export type PrayerSection = {
  type: string
  label: string
  text: string
}

// The liturgical day as reported by the chosen breviary's OWN source (not a
// computed Roman calendar). `season`/`color` are free strings from the source
// (e.g. divineoffice's "White"); used for the accent when present.
export type LiturgicalDay = {
  title: string
  color?: string
  season?: string
}

export type HourContent = {
  slug: string
  name: string
  date: string
  sections: PrayerSection[]
  day?: LiturgicalDay
}

export type HoursIndex = {
  date: string
  hours: HourInfo[]
  day?: LiturgicalDay
}

export type PrayerPage = {
  sectionIndex: number
  sectionLabel: string
  text: string
  pageInSection: number
  totalPagesInSection: number
}

export type ScrollMode = 'manual' | 'auto' | 'head-gesture'

export type DisplayColumns = 1 | 2

export type Language = 'en' | 'it'

export type LiturgySettings = {
  breviaryId: string | null  // null = not yet selected (triggers picker)
  scrollMode: ScrollMode
  autoScrollSeconds: number
  silenceEnabled: boolean    // extra contemplative pause after psalms/canticles/reading
  silenceSeconds: number
  headTiltDeg: number        // head-tilt dead zone (degrees) before paging kicks in
  tapToAdvance: boolean
  templeNav: boolean         // left temple = previous page, right temple = next (SDK 0.0.14 eventSource)
  toneBrightness: boolean    // per-line textColor: spoken text bright, rubrics dim
  solarHours: boolean        // anchor the little hours to sunrise/sunset here, not the clock
  hiddenHours: string[]
  fontSize: number
  fontWeight: number
  letterSpacing: number
  displayColumns: DisplayColumns
}

export type LiturgyPhase =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'mock'
  | 'loading'
  | 'reading'
  | 'error'
