import './styles.css'
import { waitForEvenAppBridge } from '@evenrealities/even_hub_sdk'
import { createLiturgyController } from './liturgy-controller'
import { withTimeout } from './shared/async'
import { loadSettings, saveSettings, setBreviaryId } from './settings'
import { showBreviaryPicker } from './breviary-picker'
import { showReadingView } from './reading-view'
import { showRemote } from './remote-view'
import { getBreviary, localeFor, DEFAULT_BREVIARY_ID, type BreviarySource, type Locale } from './breviaries'
import { prefetchWeek, nextNDates, type PrefetchProgress } from './api-client'
import { clearCache, cacheStats } from './cache'
import { getLiturgicalSeason, SEASON_STYLE, litColorHex, type SeasonId } from './liturgical-season'
import { icon, fleuron, adventCandles, christmasWreath, easterTomb, pentecostDove } from './illum-heroes'
import type { LiturgyPhase, HourInfo, ScrollMode } from './types'

// ── Localized chrome. Hour names + reading text come from real data; this is
//    the surrounding UI copy + season display names, keyed by breviary locale. ──
type Strings = {
  title: string
  s: Record<SeasonId, string>
  nowGlasses: string; hoursHead: string; settingsHead: string; advanced: string
  alleluia: string; comeSpirit: string; noel: string
  rows: { breviary: string; scroll: string; tap: string; sec: string; visible: string; silence: string; silenceSec: string }
  modes: Record<ScrollMode, string>
  onWord: string; offWord: string
  ui: { prev: string; next: string; stop: string; fol: string; of: string; reading: string; play: string; pause: string; back: string; remote: string; done: string }
}

const STRINGS: Record<Locale, Strings> = {
  en: {
    title: 'Liturgy of the Hours',
    s: { advent: 'Advent', christmas: 'Christmastide', ordinary: 'Ordinary Time', lent: 'Lent', easter: 'Eastertide', pentecost: 'Pentecost' },
    nowGlasses: 'Now on the glasses', hoursHead: 'The Hours of the Day', settingsHead: 'Settings', advanced: 'Advanced · event log & cache',
    alleluia: 'Alleluia', comeSpirit: 'Come, Holy Spirit', noel: 'Venite adoremus',
    rows: { breviary: 'Breviary', scroll: 'Scroll mode', tap: 'Tap to advance', sec: 'Seconds per page', visible: 'Visible hours', silence: 'Silence pauses', silenceSec: 'Silence (sec)' },
    modes: { manual: 'Manual', auto: 'Auto-scroll', 'head-gesture': 'Head gestures' },
    onWord: 'enabled', offWord: 'disabled',
    ui: { prev: 'prev', next: 'next', stop: 'stop', fol: 'fol.', of: 'of', reading: 'Reading', play: 'play', pause: 'pause', back: 'Hours', remote: 'Remote', done: 'Done' },
  },
  it: {
    title: 'Liturgia delle Ore',
    s: { advent: 'Avvento', christmas: 'Tempo di Natale', ordinary: 'Tempo Ordinario', lent: 'Quaresima', easter: 'Tempo di Pasqua', pentecost: 'Pentecoste' },
    nowGlasses: 'Ora sugli occhiali', hoursHead: 'Le Ore del giorno', settingsHead: 'Impostazioni', advanced: 'Avanzate · registro & cache',
    alleluia: 'Alleluia', comeSpirit: 'Vieni, Spirito Santo', noel: 'Venite adoriamo',
    rows: { breviary: 'Breviario', scroll: 'Scorrimento', tap: 'Tocca per avanzare', sec: 'Secondi per pagina', visible: 'Ore visibili', silence: 'Pause di silenzio', silenceSec: 'Silenzio (sec)' },
    modes: { manual: 'Manuale', auto: 'Auto', 'head-gesture': 'Gesti della testa' },
    onWord: 'attivo', offWord: 'disattivo',
    ui: { prev: 'indietro', next: 'avanti', stop: 'ferma', fol: 'fol.', of: 'di', reading: 'Lettura', play: 'riprendi', pause: 'pausa', back: 'Ore', remote: 'Telecomando', done: 'Fatto' },
  },
  ord: {
    title: 'The Daily Office',
    s: { advent: 'Advent', christmas: 'Christmastide', ordinary: 'Time after Trinity', lent: 'Lent', easter: 'Eastertide', pentecost: 'Whitsun' },
    nowGlasses: 'Now on the glasses', hoursHead: 'The Offices of the Day', settingsHead: 'Settings', advanced: 'Advanced · event log & cache',
    alleluia: 'Alleluia', comeSpirit: 'Come, Holy Ghost', noel: 'O come, let us adore him',
    rows: { breviary: 'Breviary', scroll: 'Scroll mode', tap: 'Tap to advance', sec: 'Seconds per page', visible: 'Visible offices', silence: 'Silent pauses', silenceSec: 'Silence (sec)' },
    modes: { manual: 'Manual', auto: 'Auto-scroll', 'head-gesture': 'Head gestures' },
    onWord: 'enabled', offWord: 'disabled',
    ui: { prev: 'prev', next: 'next', stop: 'stop', fol: 'fol.', of: 'of', reading: 'Reading', play: 'play', pause: 'pause', back: 'Offices', remote: 'Remote', done: 'Done' },
  },
}

// ── helpers ──
const ROMAN_HOURS = ['j', 'ij', 'iij', 'iv', 'v', 'vj', 'vij', 'viij']
function roman(n: number): string {
  const map: [number, string][] = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']]
  let s = ''
  for (const [v, sym] of map) { while (n >= v) { s += sym; n -= v } }
  return s.replace(/i$/, 'j') // manuscript final j
}
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
function versal(title: string): string {
  return (title.replace(/^(the|il|la|lo|le|gli)\s+/i, '')[0] || 'L').toUpperCase()
}

// Parse a glasses-formatted page (== HEAD ==, R/, (sub), [rubric]) into the
// panel's fields. Best-effort; degrades to plain first lines.
function parsePage(page: string): { section: string; sub: string; v: string; r: string } {
  const lines = page.split('\n').map((l) => l.trim()).filter(Boolean)
  let section = '', sub = '', v = '', r = ''
  const content: string[] = []
  for (const l of lines) {
    const h = l.match(/^==\s*(.+?)\s*==$/)
    if (h) { if (!section) section = h[1]; continue }
    const it = l.match(/^\((.+)\)$/)
    if (it) { if (!sub) sub = it[1]; continue }
    if (/^\[.*\]$/.test(l)) continue // rubric
    const resp = l.match(/^R\/\s*(.*)$/)
    if (resp) { if (!r) { r = resp[1] || ''; } continue }
    content.push(l)
  }
  if (!section) section = content.shift() || ''
  if (!v) v = content.shift() || ''
  return { section, sub, v, r }
}

const app = document.querySelector<HTMLDivElement>('#app')
if (!app) throw new Error('Missing #app')

// Dev-only overrides (so all seasons/themes can be previewed despite the fixed
// real date): ?season=advent|christmas|ordinary|lent|easter|pentecost & ?theme=dark|light
const params = new URLSearchParams(location.search)
const seasonOverride = params.get('season') as SeasonId | null
const themeOverride = params.get('theme')

function resolveSeason(): { season: SeasonId; adventWeek: number } {
  const valid: SeasonId[] = ['advent', 'christmas', 'ordinary', 'lent', 'easter', 'pentecost']
  if (seasonOverride && valid.includes(seasonOverride)) {
    return { season: seasonOverride, adventWeek: Number(params.get('week')) || 2 }
  }
  return getLiturgicalSeason(new Date())
}
function resolveDark(): boolean {
  if (themeOverride === 'dark') return true
  if (themeOverride === 'light') return false
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
}

const HOST_BREV_KEY = 'lit.breviaryId'

// Recover the chosen breviary from host-backed storage (the packaged webview's
// own localStorage can reset between launches). Validated against the registry.
async function readHostBreviary(): Promise<string | null> {
  try {
    const bridge = await withTimeout(waitForEvenAppBridge(), 2000)
    const v = await bridge.getLocalStorage(HOST_BREV_KEY)
    return v && getBreviary(v).id === v ? v : null
  } catch { return null }
}

async function bootstrap() {
  // Set theme/season on <html> up-front so the first-launch picker is themed too.
  const { season } = resolveSeason()
  document.documentElement.dataset.theme = resolveDark() ? 'dark' : 'light'
  document.documentElement.dataset.season = season

  let settings = loadSettings()
  // Fast path: localStorage kept the choice → render at once. Otherwise show a
  // brief splash and recover the choice from host storage before rendering, so
  // a glasses launch opens YOUR breviary instead of defaulting to English.
  if (settings.breviaryId == null) {
    app!.innerHTML = `<div class="ilp" style="min-height:100vh;display:flex;align-items:center;justify-content:center"><div class="ilp-hero-title" style="opacity:.65;font-size:22px">${esc(STRINGS.en.title)}</div></div>`
    const hostId = await readHostBreviary()
    if (hostId) { setBreviaryId(hostId); settings = loadSettings() }
  }
  renderApp(getBreviary(settings.breviaryId ?? DEFAULT_BREVIARY_ID))
  // True first run (no local + no host choice): offer the picker non-blockingly.
  if (settings.breviaryId == null) {
    void showBreviaryPicker().then((id) => { if (id) location.reload() })
  }
}
void bootstrap()

function todayInputValue(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function dateInputToApi(val: string): string { return val.replace(/-/g, '') }

function renderApp(breviary: BreviarySource) {
  const { season, adventWeek } = resolveSeason()
  const dark = resolveDark()
  const style = SEASON_STYLE[season]
  const L = STRINGS[localeFor(breviary.id)]

  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  document.documentElement.dataset.season = season

  const now = new Date()
  const langTag = localeFor(breviary.id) === 'it' ? 'it' : 'en'
  const weekday = new Intl.DateTimeFormat(langTag, { weekday: 'long' }).format(now)
  const dateStr = new Intl.DateTimeFormat(langTag, { day: 'numeric', month: 'short' }).format(now)

  if (style.austere) app!.innerHTML = lentMarkup(breviary, L)
  else app!.innerHTML = illuminatedMarkup(breviary, L, season, adventWeek, dark, weekday, dateStr)

  wireUpApp(breviary, L, !!style.austere)
}

// ── Illuminated layout markup ──
function seasonHeader(breviary: BreviarySource, L: Strings, season: SeasonId, adventWeek: number, dark: boolean, weekday: string, dateStr: string): string {
  const style = SEASON_STYLE[season]
  const rubric = `<div class="ilp-rubric-line"><span class="v">℣.</span> ${esc(weekday)}, ${esc(dateStr)} — ${esc(L.s[season])}</div>`
  if (style.motif === 'hero') {
    const hero = season === 'christmas' ? christmasWreath(dark) : season === 'easter' ? easterTomb(dark) : pentecostDove(dark)
    const tagline = season === 'christmas' ? L.noel : season === 'easter' ? L.alleluia + '!' : L.comeSpirit
    return `<div class="ilp-hero">${hero}
        <div class="ilp-hero-title">${esc(L.title)}</div>
        <div class="ilp-hero-sub">${esc(breviary.badge)} · ${esc(breviary.name)}</div>
      </div>${rubric}<div class="ilp-tagline">${esc(tagline)}</div>`
  }
  const orn = season === 'advent'
    ? adventCandles(adventWeek, { band: style.band, rose: style.rose || '#c98ab0', gold: dark ? '#cda44f' : '#a9842f' })
    : fleuron(dark ? '#cda44f' : '#a9842f', 12)
  return `<div class="ilp-incipit"><div class="ilp-incipit-in">
      <div class="ilp-versal">${versal(L.title)}</div>
      <div><h1>${esc(L.title)}</h1><div class="sub">${esc(breviary.badge)} · ${esc(breviary.name)}</div></div>
    </div></div>${rubric}<div class="ilp-orn">${orn}</div>`
}

function settingsBlock(breviary: BreviarySource, L: Strings): string {
  const s = loadSettings()
  return `<div class="ilp-body">
    <div class="ilp-head">${esc(L.settingsHead)}</div>
    <div class="ilp-setrow tap" id="brev-row">
      <span class="k">${esc(L.rows.breviary)}</span>
      <span class="v"><span class="ilp-brev-badge">${esc(breviary.badge)}</span> ${esc(breviary.name)} ›</span>
    </div>
    <div class="ilp-setrow"><span class="k">${esc(L.rows.scroll)}</span><span class="v">
      <select id="set-scroll">
        <option value="manual"${s.scrollMode === 'manual' ? ' selected' : ''}>${esc(L.modes.manual)}</option>
        <option value="auto"${s.scrollMode === 'auto' ? ' selected' : ''}>${esc(L.modes.auto)}</option>
        <option value="head-gesture"${s.scrollMode === 'head-gesture' ? ' selected' : ''}>${esc(L.modes['head-gesture'])}</option>
      </select></span></div>
    <div class="ilp-setrow" id="tilt-row"${s.scrollMode === 'head-gesture' ? '' : ' hidden'}><span class="k">Tilt dead zone (°)</span><span class="v"><input id="set-tilt" type="number" min="3" max="60" step="1" value="${s.headTiltDeg}" style="width:48px"></span></div>
    <div class="ilp-setrow"><span class="k">${esc(L.rows.tap)}</span><span class="v">
      <select id="set-tap"><option value="1"${s.tapToAdvance ? ' selected' : ''}>${esc(L.onWord)}</option><option value="0"${!s.tapToAdvance ? ' selected' : ''}>${esc(L.offWord)}</option></select></span></div>
    <div class="ilp-setrow"><span class="k">${esc(L.rows.sec)}</span><span class="v"><input id="set-seconds" type="number" min="2" max="60" step="1" value="${s.autoScrollSeconds}" style="width:48px"></span></div>
    <div class="ilp-setrow"><span class="k">${esc(L.rows.silence)}</span><span class="v">
      <select id="set-silence"><option value="1"${s.silenceEnabled ? ' selected' : ''}>${esc(L.onWord)}</option><option value="0"${!s.silenceEnabled ? ' selected' : ''}>${esc(L.offWord)}</option></select></span></div>
    <div class="ilp-setrow"><span class="k">${esc(L.rows.silenceSec)}</span><span class="v"><input id="set-silence-seconds" type="number" min="0" max="120" step="1" value="${s.silenceSeconds}" style="width:48px"></span></div>
    <div class="ilp-setrow tap" id="visible-row" style="border-bottom:none"><span class="k">${esc(L.rows.visible)}</span><span class="v" id="visible-val"></span></div>
    <div id="hour-toggles" class="ilp-toggle-grid" hidden></div>
  </div>
  <div class="ilp-adv" id="adv-toggle">— ${esc(L.advanced)} —</div>
  ${advancedBlock()}`
}

function advancedBlock(): string {
  const detected = document.documentElement.dataset.season || '?'
  const override = new URLSearchParams(location.search).get('season') ? ' (override)' : ''
  const today = new Date().toDateString()
  return `<div class="ilp-advbody" id="adv-body" hidden>
    <div class="ilp-setrow"><span class="k">Season</span><span class="v">${esc(detected)}${override} · ${esc(today)}</span></div>
    <div class="ilp-prefetch" id="prefetch" hidden><span id="prefetch-label"></span><div class="bar"><div class="fill" id="prefetch-fill"></div></div></div>
    <div class="ilp-setrow"><span class="k">Date</span><span class="v"><input id="date-input" type="date" value="${todayInputValue()}"></span></div>
    <div class="ilp-setrow"><span class="k">Cache</span><span class="v" style="gap:12px"><span id="refresh-all" style="cursor:pointer;text-decoration:underline">refresh all</span><span id="copy-log" style="cursor:pointer;text-decoration:underline">copy log</span><span id="clear-log" style="cursor:pointer;text-decoration:underline">clear log</span></span></div>
    <pre class="ilp-log" id="event-log"></pre>
  </div>`
}

function glassesPanelShell(L: Strings): string {
  return `<div class="ilp-head" style="margin-bottom:8px">${esc(L.nowGlasses)}</div>
    <div class="ilp-panel is-empty" id="glasses-panel"></div>`
}

function illuminatedMarkup(breviary: BreviarySource, L: Strings, season: SeasonId, adventWeek: number, dark: boolean, weekday: string, dateStr: string): string {
  return `<div class="ilp">
    ${seasonHeader(breviary, L, season, adventWeek, dark, weekday, dateStr)}
    <div class="ilp-body">
      <div class="ilp-head" id="day-title">${esc(L.s[season])}</div>
      <div id="hour-list"></div>
    </div>
    ${glassesPanelShell(L)}
    ${settingsBlock(breviary, L)}
  </div>`
}

// ── Lent (brutalist) markup ──
function lentMarkup(breviary: BreviarySource, L: Strings): string {
  const s = loadSettings()
  return `<div class="lent">
    <div class="lent-head">
      <div class="lent-kicker">${esc(breviary.badge)} · ${esc(breviary.name.toUpperCase())}</div>
      <div class="lent-title">${esc(L.title)}</div>
      <div class="lent-season">${esc(L.s.lent)}</div>
    </div>
    <div class="lent-meta" id="day-title">${esc(L.s.lent.toUpperCase())} · NO ${esc(L.alleluia.toUpperCase())}</div>
    <div class="lent-sec">${esc(L.hoursHead)}</div>
    <div id="hour-list"></div>
    <div class="lent-sec">${esc(L.nowGlasses)}</div>
    <div class="lent-block" id="glasses-panel"></div>
    <div class="lent-sec">${esc(L.settingsHead)}</div>
    <div class="lent-srow tap" id="brev-row"><span class="k">${esc(L.rows.breviary)}</span><span class="v">${esc(breviary.badge)} · ${esc(breviary.name)} ›</span></div>
    <div class="lent-srow"><span class="k">${esc(L.rows.scroll)}</span><span class="v"><select id="set-scroll" style="background:none;border:none;font:inherit;color:inherit">
      <option value="manual"${s.scrollMode === 'manual' ? ' selected' : ''}>${esc(L.modes.manual.toUpperCase())}</option>
      <option value="auto"${s.scrollMode === 'auto' ? ' selected' : ''}>${esc(L.modes.auto.toUpperCase())}</option>
      <option value="head-gesture"${s.scrollMode === 'head-gesture' ? ' selected' : ''}>${esc(L.modes['head-gesture'].toUpperCase())}</option>
    </select></span></div>
    <div class="lent-srow"><span class="k">${esc(L.rows.tap)}</span><span class="v"><select id="set-tap" style="background:none;border:none;font:inherit;color:inherit"><option value="1"${s.tapToAdvance ? ' selected' : ''}>${esc(L.onWord.toUpperCase())}</option><option value="0"${!s.tapToAdvance ? ' selected' : ''}>${esc(L.offWord.toUpperCase())}</option></select></span></div>
    <div class="lent-srow tap" id="visible-row"><span class="k">${esc(L.rows.visible)}</span><span class="v" id="visible-val"></span></div>
    <div id="hour-toggles" class="ilp-toggle-grid" hidden style="padding:0 20px"></div>
    <input id="set-seconds" type="hidden" value="${s.autoScrollSeconds}">
    <div class="lent-srow" id="adv-toggle"><span class="k">Advanced</span><span class="v">event log & cache ›</span></div>
    <div id="adv-body" hidden style="padding:0 4px">
      <div class="ilp-prefetch" id="prefetch" hidden><span id="prefetch-label"></span><div class="bar"><div class="fill" id="prefetch-fill"></div></div></div>
      <div class="lent-srow"><span class="k">Date</span><span class="v"><input id="date-input" type="date" value="${todayInputValue()}" style="background:none;border:1px solid var(--lhair);color:inherit;font:inherit"></span></div>
      <div class="lent-srow"><span class="k">Cache</span><span class="v" style="gap:12px"><span id="refresh-all" style="cursor:pointer;text-decoration:underline">refresh all</span> <span id="copy-log" style="cursor:pointer;text-decoration:underline">copy log</span> <span id="clear-log" style="cursor:pointer;text-decoration:underline">clear log</span></span></div>
      <pre class="ilp-log" id="event-log" style="margin:10px 20px 0"></pre>
    </div>
    <div class="lent-note"><b>Q:</b> Where did my CSS / formatting go?<br><b>A:</b> It's Lent. We gave that up. It'll be back on Easter.</div>
  </div>`
}

function wireUpApp(breviary: BreviarySource, L: Strings, lent: boolean) {
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null
  const hourList = $('hour-list')!
  const panel = $('glasses-panel')!
  const logEl = $('event-log') as HTMLPreElement | null

  let currentHours: HourInfo[] = []
  let activeSlug: string | null = null
  let activeHourName = ''
  const visited = new Set<string>()
  let phase: LiturgyPhase = 'idle'

  function appendLog(text: string) {
    if (!logEl) return
    const time = new Date().toLocaleTimeString()
    logEl.textContent = `[${time}] ${text}\n${logEl.textContent ?? ''}`
    const lines = (logEl.textContent ?? '').split('\n')
    if (lines.length > 200) logEl.textContent = lines.slice(0, 200).join('\n')
  }

  function hourKeyFromName(name: string): string {
    return name.toLowerCase().replace(/\s+/g, '-').replace(/yesterday's-/, '')
  }
  function latinFor(name: string): string {
    const key = hourKeyFromName(name)
    return breviary.hours.find((h) => h.key === key)?.latin || ''
  }

  function stateGlyphIlp(slug: string): string {
    if (slug === activeSlug && phase === 'reading') return '<span class="ilp-mani">☞</span>'
    if (visited.has(slug)) return '<span class="tm">✓</span>'
    return '<span class="tm"></span>'
  }

  function renderHourButtons(hours: HourInfo[]) {
    const s = loadSettings()
    const shown = hours.filter((h) => !s.hiddenHours.includes(hourKeyFromName(h.name)))
    if (lent) {
      hourList.innerHTML = shown.map((h, i) => {
        const live = h.slug === activeSlug && phase === 'reading'
        const cls = live ? ' live' : visited.has(h.slug) ? ' done' : ''
        const right = live ? 'NOW' : visited.has(h.slug) ? '✓' : ''
        return `<button class="lent-hr${cls}" data-slug="${esc(h.slug)}"><span class="n">${String(i + 1).padStart(2, '0')}</span><span class="nm">${esc(h.name)}</span><span class="t">${right}</span></button>`
      }).join('')
    } else {
      hourList.innerHTML = shown.map((h, i) => {
        const num = ROMAN_HOURS[i] || roman(i + 1)
        const live = h.slug === activeSlug && phase === 'reading'
        const lt = latinFor(h.name)
        return `<button class="ilp-hour${live ? ' live' : visited.has(h.slug) ? ' done' : ''}" data-slug="${esc(h.slug)}">
          <span class="rub">${num}</span>
          <div class="ilp-main"><span class="nm">${esc(h.name)}</span>${lt ? `<span class="lt">${esc(lt)}</span>` : ''}</div>
          ${stateGlyphIlp(h.slug)}
        </button>`
      }).join('')
    }
  }

  function refreshPanel() {
    const st = controller.getState() as any
    const reading = st.view === 'reading' && Array.isArray(st.pages) && st.pages.length > 0
    if (!reading) {
      if (lent) { panel.innerHTML = `<div class="bh">—</div><div class="bt" style="font-size:16px;opacity:.6;padding:12px">${esc(L.ui.reading)}: —</div>` }
      else { panel.className = 'ilp-panel is-empty'; panel.innerHTML = `<div class="ilp-panel-h">${icon('glasses', { size: 12, stroke: 'var(--gold)' })} —</div><div class="ilp-psalm-sub" style="text-align:center;margin-top:10px">${esc(L.ui.reading)}: —</div>` }
      return
    }
    const page = String(st.pages[st.pageIndex] || '')
    const fol = st.pageIndex + 1, total = st.pages.length
    const p = parsePage(page)
    const hour = activeHourName || ''
    const isAuto = loadSettings().scrollMode === 'auto'
    const paused = !!st.autoPaused
    const ppLabel = paused ? `▶ ${L.ui.play}` : `❚❚ ${L.ui.pause}`
    if (lent) {
      panel.innerHTML = `<div class="bh">${esc(hour)}</div>
        <div class="bt">${esc(p.section || '—')}</div>
        <div class="bs">${esc(p.sub || '')}${p.sub ? ' — ' : ''}${fol} / ${total}</div>
        <div class="bctrl">${isAuto ? `<button class="bbtn" data-act="playpause">${esc(ppLabel)}</button>` : ''}<button class="bbtn" data-act="prev">${esc(L.ui.prev)}</button><button class="bbtn" data-act="next">${esc(L.ui.next)}</button><button class="bbtn" data-act="remote">${esc(L.ui.remote)}</button><button class="bbtn x" data-act="stop">${esc(L.ui.stop)}</button></div>`
      return
    }
    const pct = total > 1 ? Math.round((fol / total) * 100) : 100
    const couplet = (p.v || p.r)
      ? `<div class="ilp-vers">${p.v ? `<span class="m">℣.</span> ${esc(p.v)}` : ''}${(p.v && p.r) ? '<br>' : ''}${p.r ? `<span class="m">℟.</span> ${esc(p.r)}` : ''}</div>`
      : ''
    panel.className = 'ilp-panel'
    panel.innerHTML = `
      <div class="ilp-panel-h">${icon('glasses', { size: 12, stroke: 'var(--gold)' })} ${esc(hour)}</div>
      <div class="ilp-pbody">
        <div class="ilp-cap">${esc(versal(p.section || 'P'))}</div>
        <div style="flex:1;min-width:0"><div class="ilp-psalm">${esc(p.section || '')}</div>${p.sub ? `<div class="ilp-psalm-sub">${esc(p.sub)}</div>` : ''}</div>
      </div>
      ${couplet}
      <div class="ilp-prog"><span class="lbl">${esc(L.ui.fol)} ${fol}</span><div class="bar"><div class="fill" style="width:${pct}%"></div></div><span class="lbl">${esc(L.ui.of)} ${total}</span></div>
      <div class="ilp-ctrls">${isAuto ? `<span data-act="playpause">${esc(ppLabel)}</span>` : ''}<span data-act="prev">${icon('chevron-left', { size: 15 })} ${esc(L.ui.prev)}</span><span data-act="next">${esc(L.ui.next)} ${icon('chevron-right', { size: 15 })}</span><span data-act="remote">${esc(L.ui.remote)}</span><span class="stop" data-act="stop">${esc(L.ui.stop)}</span></div>`
  }

  function updateDay() {
    const el = $('day-title'); if (!el) return
    const day = (controller.getState() as any).day
    if (!day || !day.title) return
    const dot = litColorHex(day.color)
    const dotHtml = dot ? `<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${dot};margin-right:7px;vertical-align:middle"></span>` : ''
    el.innerHTML = dotHtml + esc(lent ? String(day.title).toUpperCase() : day.title)
  }

  function updateVisibleVal() {
    const s = loadSettings()
    const total = currentHours.length
    const hidden = currentHours.filter((h) => s.hiddenHours.includes(hourKeyFromName(h.name))).length
    const val = $('visible-val'); if (val) val.textContent = `${total - hidden} / ${total}`
  }

  function renderHourToggles() {
    const grid = $('hour-toggles'); if (!grid) return
    const s = loadSettings()
    grid.innerHTML = breviary.hours.map((h) => `<label class="ilp-toggle"><input type="checkbox" data-hour-key="${esc(h.key)}"${s.hiddenHours.includes(h.key) ? '' : ' checked'}> ${esc(h.label)}</label>`).join('')
  }

  const setPhase = (p: LiturgyPhase) => {
    phase = p
    if (p === 'reading') refreshPanel()
    if (currentHours.length) renderHourButtons(currentHours)
  }

  const controller = createLiturgyController({
    setPhase,
    log: appendLog,
    onReadingChanged: () => refreshPanel(),
    onHoursLoaded(hours) { currentHours = hours; renderHourButtons(hours); updateVisibleVal(); updateDay() },
  })

  refreshPanel()
  renderHourToggles()
  updateVisibleVal()

  // ── events ──
  function openRemote() {
    showRemote(controller as any, {
      hourName: activeHourName,
      ui: { prev: L.ui.prev, next: L.ui.next, done: L.ui.done, fol: L.ui.fol, of: L.ui.of },
    })
  }

  hourList.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-slug]')
    if (!btn) return
    const slug = btn.dataset.slug!
    const hourObj = currentHours.find((h) => h.slug === slug)
    activeSlug = slug
    activeHourName = hourObj?.name ?? slug
    visited.add(slug)
    renderHourButtons(currentHours)
    // Load on the glasses (if connected) and open the full text on the phone.
    void controller.selectHour(slug).then(() => { renderHourButtons(currentHours); refreshPanel(); updateDay() })
    showReadingView({
      slug,
      name: activeHourName,
      date: hourObj?.date,
      day: (controller.getState() as any).day,
      ui: { back: L.ui.back, remote: L.ui.remote },
      onRemote: openRemote,
    })
  })

  panel.addEventListener('click', (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act
    if (act === 'prev') void controller.scrollUp().then(refreshPanel)
    else if (act === 'next') void controller.scrollDown().then(refreshPanel)
    else if (act === 'stop') { controller.stopReading(); activeSlug = null; renderHourButtons(currentHours); refreshPanel() }
    else if (act === 'playpause') {
      const paused = !!(controller.getState() as any).autoPaused
      if (paused) controller.resumeAuto(); else controller.pauseAuto()
      refreshPanel()
    }
    else if (act === 'remote') openRemote()
  })

  $('brev-row')?.addEventListener('click', async () => {
    const newId = await showBreviaryPicker()
    if (newId !== breviary.id) location.reload()
  })

  $('set-scroll')?.addEventListener('change', (e) => {
    const s = loadSettings(); s.scrollMode = (e.target as HTMLSelectElement).value as ScrollMode; saveSettings(s)
    appendLog(`Scroll mode: ${s.scrollMode}`)
    const tr = $('tilt-row'); if (tr) tr.hidden = s.scrollMode !== 'head-gesture'
  })
  $('set-tilt')?.addEventListener('change', (e) => {
    const val = Number((e.target as HTMLInputElement).value)
    if (val >= 3 && val <= 60) { const s = loadSettings(); s.headTiltDeg = val; saveSettings(s); appendLog(`Tilt dead zone: ${val}°`) }
  })
  $('set-tap')?.addEventListener('change', (e) => {
    const s = loadSettings(); s.tapToAdvance = (e.target as HTMLSelectElement).value === '1'; saveSettings(s)
    appendLog(`Tap to advance: ${s.tapToAdvance ? 'on' : 'off'}`)
  })
  $('set-seconds')?.addEventListener('change', (e) => {
    const val = Number((e.target as HTMLInputElement).value)
    if (val >= 2 && val <= 60) { const s = loadSettings(); s.autoScrollSeconds = val; saveSettings(s); appendLog(`Auto-scroll: ${val}s`) }
  })
  $('set-silence')?.addEventListener('change', (e) => {
    const s = loadSettings(); s.silenceEnabled = (e.target as HTMLSelectElement).value === '1'; saveSettings(s)
    appendLog(`Silence pauses: ${s.silenceEnabled ? 'on' : 'off'}`)
  })
  $('set-silence-seconds')?.addEventListener('change', (e) => {
    const val = Number((e.target as HTMLInputElement).value)
    if (val >= 0 && val <= 120) { const s = loadSettings(); s.silenceSeconds = val; saveSettings(s); appendLog(`Silence: ${val}s`) }
  })
  $('visible-row')?.addEventListener('click', () => {
    const grid = $('hour-toggles'); if (grid) grid.hidden = !grid.hidden
  })
  $('hour-toggles')?.addEventListener('change', () => {
    const boxes = $('hour-toggles')!.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
    const hidden: string[] = []
    boxes.forEach((cb) => { if (cb.dataset.hourKey && !cb.checked) hidden.push(cb.dataset.hourKey) })
    const s = loadSettings(); s.hiddenHours = hidden; saveSettings(s)
    renderHourButtons(currentHours); updateVisibleVal()
  })
  $('adv-toggle')?.addEventListener('click', () => { const b = $('adv-body'); if (b) b.hidden = !b.hidden })
  $('clear-log')?.addEventListener('click', () => { if (logEl) logEl.textContent = '' })
  $('copy-log')?.addEventListener('click', async () => {
    const text = logEl?.textContent ?? ''
    let ok = false
    try { await navigator.clipboard.writeText(text); ok = true } catch { /* fall back */ }
    if (!ok) {
      // Fallback for webviews without async clipboard: temporary textarea + execCommand.
      try {
        const ta = document.createElement('textarea')
        ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'
        document.body.appendChild(ta); ta.focus(); ta.select()
        ok = document.execCommand('copy')
        ta.remove()
      } catch { /* ignore */ }
    }
    const el = $('copy-log'); if (el) { const prev = el.textContent; el.textContent = ok ? 'copied!' : 'copy failed'; setTimeout(() => { if (el) el.textContent = prev }, 1500) }
  })
  $('date-input')?.addEventListener('change', (e) => {
    void controller.loadHours(dateInputToApi((e.target as HTMLInputElement).value))
  })
  $('refresh-all')?.addEventListener('click', async () => {
    const stats = cacheStats(); clearCache(); appendLog(`Cleared cache (${stats.entries} entries)`)
    await runPrefetch(); void controller.loadHours(dateInputToApi(($('date-input') as HTMLInputElement)?.value || todayInputValue()))
  })

  async function runPrefetch() {
    const card = $('prefetch'), label = $('prefetch-label'), fill = $('prefetch-fill')
    if (card) card.hidden = false
    const onProgress = (p: PrefetchProgress) => {
      const pct = p.total > 0 ? Math.round((p.done / p.total) * 100) : 0
      if (fill) fill.style.width = `${pct}%`
      if (label) label.textContent = `${p.done}/${p.total}${p.failed ? ` (${p.failed} failed)` : ''}`
    }
    try {
      const r = await prefetchWeek(nextNDates(7), breviary.id, onProgress)
      if (label) label.textContent = `${r.done}/${r.total} cached`
      setTimeout(() => { if (card) card.hidden = true }, 3000)
    } catch (err) { appendLog(`Prefetch error: ${(err as Error).message}`) }
  }

  async function startup() {
    await Promise.all([controller.loadHours(), controller.connect()])
    // Mirror the active breviary to host-backed storage so it's restored on the
    // next launch (the webview's own localStorage can reset between launches).
    void controller.setHostStorage(HOST_BREV_KEY, breviary.id)
    await controller.renderHourList().catch((err) => appendLog(`Render error: ${err}`))
    void runPrefetch()
  }
  void startup()
}
