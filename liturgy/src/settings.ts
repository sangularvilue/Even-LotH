import type { LiturgySettings, ScrollMode } from './types'

const STORAGE_KEY = 'even.liturgy.settings.v1'

const DEFAULTS: LiturgySettings = {
  scrollMode: 'manual',
  autoScrollSeconds: 8,
  hiddenHours: [],
  fontSize: 16,
  fontWeight: 100,
  letterSpacing: 0.5,
  displayColumns: 2,
}

export function loadSettings(): LiturgySettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULTS }
    const parsed = JSON.parse(raw)
    return {
      scrollMode: parsed.scrollMode === 'auto' ? 'auto' : 'manual',
      autoScrollSeconds: typeof parsed.autoScrollSeconds === 'number' && parsed.autoScrollSeconds > 0
        ? parsed.autoScrollSeconds : DEFAULTS.autoScrollSeconds,
      hiddenHours: Array.isArray(parsed.hiddenHours) ? parsed.hiddenHours : [],
      fontSize: typeof parsed.fontSize === 'number' && parsed.fontSize >= 10 && parsed.fontSize <= 28
        ? parsed.fontSize : DEFAULTS.fontSize,
      fontWeight: typeof parsed.fontWeight === 'number' && parsed.fontWeight >= 100 && parsed.fontWeight <= 900
        ? parsed.fontWeight : DEFAULTS.fontWeight,
      letterSpacing: typeof parsed.letterSpacing === 'number' && parsed.letterSpacing >= 0 && parsed.letterSpacing <= 3
        ? parsed.letterSpacing : DEFAULTS.letterSpacing,
      displayColumns: parsed.displayColumns === 1 ? 1 : 2,
    }
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveSettings(settings: LiturgySettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
}

export function updateSetting<K extends keyof LiturgySettings>(key: K, value: LiturgySettings[K]): LiturgySettings {
  const settings = loadSettings()
  settings[key] = value
  saveSettings(settings)
  return settings
}
