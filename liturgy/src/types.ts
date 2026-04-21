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

export type HourContent = {
  slug: string
  name: string
  date: string
  sections: PrayerSection[]
}

export type HoursIndex = {
  date: string
  hours: HourInfo[]
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
  language: Language | null  // null = not yet selected (triggers picker)
  scrollMode: ScrollMode
  autoScrollSeconds: number
  tapToAdvance: boolean
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
