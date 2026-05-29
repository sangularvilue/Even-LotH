import type { LiturgySettings, Language, ScrollMode } from './types'
import { getBreviary, breviaryIdForLegacyLanguage, DEFAULT_BREVIARY_ID } from './breviaries'

const STORAGE_KEY = 'even.liturgy.settings.v1'

const DEFAULTS: LiturgySettings = {
  breviaryId: null,
  scrollMode: 'manual',
  autoScrollSeconds: 12,
  silenceEnabled: true,
  silenceSeconds: 20,
  tapToAdvance: true,
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
    // v2 migration: prefer an explicit breviaryId; otherwise map the legacy
    // `language` value (pre-v2 users) onto its breviary; otherwise unset.
    const breviaryId = typeof parsed.breviaryId === 'string' && parsed.breviaryId
      ? parsed.breviaryId
      : (parsed.language === 'en' || parsed.language === 'it')
        ? breviaryIdForLegacyLanguage(parsed.language)
        : null
    return {
      breviaryId,
      scrollMode: parsed.scrollMode === 'auto' ? 'auto' : parsed.scrollMode === 'head-gesture' ? 'head-gesture' : 'manual',
      autoScrollSeconds: typeof parsed.autoScrollSeconds === 'number' && parsed.autoScrollSeconds > 0
        ? parsed.autoScrollSeconds : DEFAULTS.autoScrollSeconds,
      silenceEnabled: typeof parsed.silenceEnabled === 'boolean' ? parsed.silenceEnabled : DEFAULTS.silenceEnabled,
      silenceSeconds: typeof parsed.silenceSeconds === 'number' && parsed.silenceSeconds >= 0
        ? parsed.silenceSeconds : DEFAULTS.silenceSeconds,
      tapToAdvance: typeof parsed.tapToAdvance === 'boolean' ? parsed.tapToAdvance : DEFAULTS.tapToAdvance,
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

export function getBreviaryId(): string {
  return loadSettings().breviaryId ?? DEFAULT_BREVIARY_ID
}

export function setBreviaryId(id: string): void {
  const s = loadSettings()
  s.breviaryId = id
  saveSettings(s)
}

// Convenience shim: the UI STRINGS tables are keyed by language, derived from
// the active breviary.
export function getLanguage(): Language {
  return getBreviary(getBreviaryId()).language
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
