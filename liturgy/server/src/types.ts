export type HourSlug =
  | 'office-of-readings'
  | 'morning-prayer'
  | 'mid-morning-prayer'
  | 'midday-prayer'
  | 'mid-afternoon-prayer'
  | 'evening-prayer'
  | 'night-prayer'
  | string

export type HourInfo = {
  slug: HourSlug
  name: string
}

export type PrayerSection = {
  type: string
  label: string
  text: string
}

export type HourContent = {
  slug: HourSlug
  name: string
  date: string
  sections: PrayerSection[]
}

export type HoursIndex = {
  date: string
  hours: HourInfo[]
}
