// The Breviary registry — the single source of truth for every selectable
// breviary. Adding a breviary later means adding one entry here (plus its
// serverless endpoint pair). This replaces the old binary `language: 'en'|'it'`
// branching that was threaded through main.ts / api-client.ts / cache.ts.
//
// The on-glasses renderer is breviary-agnostic: every endpoint returns the same
// HoursIndex / HourContent contract whose section text uses the {r}/{ant}/{i}/{v}
// marker interlingua. So a breviary only has to declare *how to reach* its data
// and *what its hour list looks like*.

export type HourToggle = { key: string; label: string; latin?: string }

export type BreviaryStatus = 'live' | 'beta' | 'coming-soon'

export type BreviarySource = {
  id: string
  name: string
  language: 'en' | 'it' // drives which UI STRINGS locale is used
  publisher: string
  badge: string
  status: BreviaryStatus
  note?: string // shown in the picker and in-app (e.g. text-substitution disclosures)
  // Endpoint paths RELATIVE to SERVER_URL (api-client prepends the origin).
  api: {
    list: string
    hour: (slug: string, date: string) => string
  }
  // The "visible hours" toggle list (replaces HOUR_TOGGLES_EN / _IT).
  hours: HourToggle[]
  capabilities: {
    yesterday?: boolean // append yesterday's evening/night office for night workers
  }
}

const HOURS_EN: HourToggle[] = [
  { key: 'invitatory', label: 'Invitatory', latin: 'Invitatorium' },
  { key: 'office-of-readings', label: 'Office of Readings', latin: 'Officium lectionis' },
  { key: 'morning-prayer', label: 'Morning Prayer', latin: 'Laudes' },
  { key: 'midmorning-prayer', label: 'Midmorning Prayer', latin: 'Tertia' },
  { key: 'midday-prayer', label: 'Midday Prayer', latin: 'Sexta' },
  { key: 'midafternoon-prayer', label: 'Midafternoon Prayer', latin: 'Nona' },
  { key: 'evening-prayer', label: 'Evening Prayer', latin: 'Vesperae' },
  { key: 'night-prayer', label: 'Night Prayer', latin: 'Completorium' },
  { key: 'yesterday\'s-evening-prayer', label: 'Yesterday\'s Evening Prayer', latin: 'Vesperae' },
  { key: 'yesterday\'s-night-prayer', label: 'Yesterday\'s Night Prayer', latin: 'Completorium' },
]

const HOURS_IT: HourToggle[] = [
  { key: 'invitatorio', label: 'Invitatorio', latin: 'Invitatorium' },
  { key: 'ufficio-delle-letture', label: 'Ufficio delle letture', latin: 'Officium lectionis' },
  { key: 'lodi', label: 'Lodi', latin: 'Laudes' },
  { key: 'ora-media-—-terza', label: 'Ora Media — Terza', latin: 'Tertia' },
  { key: 'ora-media-—-sesta', label: 'Ora Media — Sesta', latin: 'Sexta' },
  { key: 'ora-media-—-nona', label: 'Ora Media — Nona', latin: 'Nona' },
  { key: 'vespri', label: 'Vespri', latin: 'Vesperae' },
  { key: 'compieta', label: 'Compieta', latin: 'Completorium' },
  { key: 'lezionario-(messa)', label: 'Lezionario (Messa)', latin: 'Ad Missam' },
  { key: 'vespri-di-ieri', label: 'Vespri di ieri', latin: 'Vesperae' },
  { key: 'compieta-di-ieri', label: 'Compieta di ieri', latin: 'Completorium' },
]

const HOURS_ORD: HourToggle[] = [
  { key: 'mattins', label: 'Mattins', latin: 'Ad Matutinum' },
  { key: 'evensong', label: 'Evensong', latin: 'Ad Vesperas' },
  { key: 'compline', label: 'Compline', latin: 'Completorium' },
  { key: 'yesterday\'s-evensong', label: 'Yesterday\'s Evensong', latin: 'Ad Vesperas' },
  { key: 'yesterday\'s-compline', label: 'Yesterday\'s Compline', latin: 'Completorium' },
]

export const BREVIARIES: BreviarySource[] = [
  {
    id: 'en-divineoffice',
    name: 'Divine Office',
    language: 'en',
    publisher: 'divineoffice.org',
    badge: 'EN',
    status: 'live',
    api: {
      list: '/api/hours',
      hour: (slug, date) => `/api/hour/${slug}?date=${date}`,
    },
    hours: HOURS_EN,
    capabilities: { yesterday: true },
  },
  {
    id: 'it-cei',
    name: 'Liturgia delle Ore',
    language: 'it',
    publisher: 'CEI · liturgiadelleore.it',
    badge: 'IT',
    status: 'beta',
    api: {
      list: '/api/hours_it',
      hour: (slug, date) => `/api/hour_it?slug=${encodeURIComponent(slug)}&date=${date}`,
    },
    hours: HOURS_IT,
    capabilities: { yesterday: true },
  },
  {
    id: 'ordinariate',
    name: 'Ordinariate Daily Office',
    language: 'en',
    publisher: 'dwdo.uk',
    badge: 'Ord',
    status: 'live',
    note: 'Scripture lessons are shown in the Authorized Version (KJV). The Ordinariate’s RSV-2CE is under copyright and cannot be embedded; the KJV is public-domain and permitted in the Ordinariate.',
    api: {
      list: '/api/hours_ord',
      hour: (slug, date) => `/api/hour_ord?slug=${encodeURIComponent(slug)}&date=${date}`,
    },
    hours: HOURS_ORD,
    capabilities: { yesterday: true },
  },
  {
    id: 'en-icel2026',
    name: 'Divine Office (ICEL 2026)',
    language: 'en',
    publisher: 'new English translation',
    badge: 'EN',
    status: 'coming-soon',
    api: {
      list: '/api/hours',
      hour: (slug, date) => `/api/hour/${slug}?date=${date}`,
    },
    hours: HOURS_EN,
    capabilities: { yesterday: true },
  },
]

export const DEFAULT_BREVIARY_ID = 'en-divineoffice'

export function getBreviary(id: string | null | undefined): BreviarySource {
  return BREVIARIES.find((b) => b.id === id) ?? BREVIARIES[0]!
}

// UI locale for a breviary. The Ordinariate uses traditional English ('ord' —
// "Whitsun", "The Daily Office") distinct from modern English ('en').
export type Locale = 'en' | 'it' | 'ord'
export function localeFor(breviaryId: string): Locale {
  if (breviaryId === 'it-cei') return 'it'
  if (breviaryId === 'ordinariate') return 'ord'
  return 'en'
}

// Map a legacy `language` value (the pre-v2 setting) to a breviary id.
export function breviaryIdForLegacyLanguage(lang: string | null | undefined): string {
  if (lang === 'it') return 'it-cei'
  return DEFAULT_BREVIARY_ID
}
