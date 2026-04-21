import './styles.css'
import { createLiturgyController } from './liturgy-controller'
import { loadSettings, saveSettings, getLanguage, setLanguage } from './settings'
import { showLanguagePicker } from './language-picker'
import { prefetchWeek, nextNDates, type PrefetchProgress } from './api-client'
import { clearCache, cacheStats } from './cache'
import type { LiturgyPhase, HourInfo, ScrollMode, Language } from './types'

// ── Hour toggle lists per language ──

type HourToggle = { key: string; label: string }

const HOUR_TOGGLES_EN: HourToggle[] = [
  { key: 'invitatory', label: 'Invitatory' },
  { key: 'office-of-readings', label: 'Office of Readings' },
  { key: 'morning-prayer', label: 'Morning Prayer' },
  { key: 'midmorning-prayer', label: 'Midmorning Prayer' },
  { key: 'midday-prayer', label: 'Midday Prayer' },
  { key: 'midafternoon-prayer', label: 'Midafternoon Prayer' },
  { key: 'evening-prayer', label: 'Evening Prayer' },
  { key: 'night-prayer', label: 'Night Prayer' },
  { key: 'yesterday\'s-evening-prayer', label: 'Yesterday\'s Evening Prayer' },
  { key: 'yesterday\'s-night-prayer', label: 'Yesterday\'s Night Prayer' },
]

const HOUR_TOGGLES_IT: HourToggle[] = [
  { key: 'invitatorio', label: 'Invitatorio' },
  { key: 'ufficio-delle-letture', label: 'Ufficio delle letture' },
  { key: 'lodi', label: 'Lodi' },
  { key: 'ora-media-—-terza', label: 'Ora Media — Terza' },
  { key: 'ora-media-—-sesta', label: 'Ora Media — Sesta' },
  { key: 'ora-media-—-nona', label: 'Ora Media — Nona' },
  { key: 'vespri', label: 'Vespri' },
  { key: 'compieta', label: 'Compieta' },
  { key: 'vespri-di-ieri', label: 'Vespri di ieri' },
  { key: 'compieta-di-ieri', label: 'Compieta di ieri' },
]

const STRINGS = {
  en: {
    title: 'Liturgy of the Hours',
    subtitle: 'Divine Office prayer reader for glasses',
    connectGlasses: 'Connect glasses',
    dateHours: 'Date & Hours',
    load: 'Load',
    reading: 'Reading',
    prev: 'Prev',
    next: 'Next',
    stop: 'Stop',
    settings: 'Settings',
    scrollMode: 'Scroll mode',
    manual: 'Manual',
    autoScroll: 'Auto-scroll',
    headGesture: 'Head gestures',
    tapToAdvance: 'Tap to advance',
    enabled: 'Enabled',
    secondsPerPage: 'Seconds per page',
    visibleHours: 'Visible hours',
    controls: 'Glasses Controls',
    controlsHint: 'Hour list: Scroll to navigate, Tap to select. Reading: Tap to advance page (if enabled), Scroll up/down to change page, Double-tap to go back.',
    eventLog: 'Event Log',
    clear: 'Clear',
    refreshAll: 'Refresh all',
    cache: 'Cache',
    ready: 'Ready',
  },
  it: {
    title: 'Liturgia delle Ore',
    subtitle: 'Ufficio divino per gli occhiali',
    connectGlasses: 'Connetti occhiali',
    dateHours: 'Data e Ore',
    load: 'Carica',
    reading: 'Lettura',
    prev: 'Indietro',
    next: 'Avanti',
    stop: 'Ferma',
    settings: 'Impostazioni',
    scrollMode: 'Scorrimento',
    manual: 'Manuale',
    autoScroll: 'Auto',
    headGesture: 'Gesti della testa',
    tapToAdvance: 'Tocca per avanzare',
    enabled: 'Attivo',
    secondsPerPage: 'Secondi per pagina',
    visibleHours: 'Ore visibili',
    controls: 'Controlli occhiali',
    controlsHint: 'Elenco ore: scorri per navigare, tocca per selezionare. Lettura: tocca per avanzare (se attivo), scorri per cambiare pagina, doppio-tocco per tornare.',
    eventLog: 'Registro eventi',
    clear: 'Pulisci',
    refreshAll: 'Aggiorna tutto',
    cache: 'Cache',
    ready: 'Pronto',
  },
} as const

// ── Bootstrap ──

const app = document.querySelector<HTMLDivElement>('#app')
if (!app) throw new Error('Missing #app')

async function bootstrap() {
  let settings = loadSettings()
  if (settings.language == null) {
    await showLanguagePicker()
    settings = loadSettings()
  }
  renderApp(settings.language!)
}
void bootstrap()

function todayInputValue(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function dateInputToApi(val: string): string {
  return val.replace(/-/g, '')
}

// Render the main app UI after language has been chosen.
function renderApp(lang: Language) {
  const t = STRINGS[lang]
  const toggles = lang === 'it' ? HOUR_TOGGLES_IT : HOUR_TOGGLES_EN
  const settings = loadSettings()

  app!.innerHTML = `
    <header class="hero card">
      <div>
        <p class="eyebrow">Even G2 <span id="lang-badge" class="lang-badge" title="Change language">${lang.toUpperCase()}</span></p>
        <h1 class="page-title">${t.title}</h1>
        <p class="page-subtitle">${t.subtitle}</p>
      </div>
      <div id="hero-pill" class="hero-pill is-ready" aria-live="polite">${t.ready}</div>
    </header>

    <section class="card">
      <div class="top-actions">
        <button id="connect-btn" class="btn btn-primary connect-glasses-btn" type="button">${t.connectGlasses}</button>
      </div>
    </section>

    <section id="prefetch-card" class="card" hidden>
      <div id="prefetch-banner" class="prefetch-banner">
        <span class="prefetch-label" id="prefetch-label">Loading week…</span>
        <div class="prefetch-bar"><div class="prefetch-bar-fill" id="prefetch-fill" style="width:0%"></div></div>
      </div>
    </section>

    <section class="card">
      <p class="section-label">${t.dateHours}</p>
      <div class="date-row">
        <input id="date-input" class="date-input" type="date" value="${todayInputValue()}" />
        <button id="load-btn" class="btn btn-primary compact" type="button">
          <span class="btn-title">${t.load}</span>
        </button>
      </div>
      <div id="hour-grid" class="hour-grid"></div>
    </section>

    <section id="reading-card" class="reading-card card">
      <p class="section-label">${t.reading}</p>
      <div class="reading-header">
        <span id="reading-section" class="reading-section-label"></span>
        <span id="reading-progress" class="reading-progress"></span>
      </div>
      <div id="reading-text" class="reading-text"></div>
      <div class="reading-nav">
        <button id="prev-btn" class="btn" type="button"><span class="btn-title">${t.prev}</span></button>
        <button id="next-btn" class="btn" type="button"><span class="btn-title">${t.next}</span></button>
        <button id="stop-reading-btn" class="btn btn-ghost" type="button"><span class="btn-title">${t.stop}</span></button>
      </div>
    </section>

    <section class="card">
      <p class="section-label">${t.settings}</p>
      <div class="settings-grid">
        <div class="setting-row">
          <span class="setting-label">${t.scrollMode}</span>
          <select id="scroll-mode-select" class="setting-select">
            <option value="manual" ${settings.scrollMode === 'manual' ? 'selected' : ''}>${t.manual}</option>
            <option value="auto" ${settings.scrollMode === 'auto' ? 'selected' : ''}>${t.autoScroll}</option>
            <option value="head-gesture" ${settings.scrollMode === 'head-gesture' ? 'selected' : ''}>${t.headGesture}</option>
          </select>
        </div>
        <div class="setting-row">
          <span class="setting-label">${t.tapToAdvance}</span>
          <label class="hour-toggle"><input id="tap-advance-check" type="checkbox" ${settings.tapToAdvance ? 'checked' : ''} /> ${t.enabled}</label>
        </div>
        <div class="setting-row">
          <span class="setting-label">${t.secondsPerPage}</span>
          <input id="scroll-speed-input" class="setting-input" type="number" min="2" max="60" step="1" value="${settings.autoScrollSeconds}" style="width:70px" />
        </div>
        <div>
          <span class="setting-label">${t.visibleHours}</span>
          <div id="hour-toggles" class="hour-toggle-grid">
            ${toggles.map(h => `
              <label class="hour-toggle">
                <input type="checkbox" data-hour-key="${h.key}" ${settings.hiddenHours.includes(h.key) ? '' : 'checked'} />
                ${h.label}
              </label>
            `).join('')}
          </div>
        </div>
        <div class="setting-row">
          <span class="setting-label">${t.cache}</span>
          <button id="refresh-all-btn" class="btn btn-ghost compact" type="button">
            <span class="btn-title">${t.refreshAll}</span>
          </button>
        </div>
      </div>
    </section>

    <section class="card">
      <p class="section-label">${t.controls}</p>
      <p class="hint">${t.controlsHint}</p>
    </section>

    <section class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
        <p class="log-title" style="margin:0">${t.eventLog}</p>
        <button id="clear-log-btn" class="btn btn-ghost compact" type="button" style="padding:4px 10px;font-size:0.72rem">
          <span class="btn-title">${t.clear}</span>
        </button>
      </div>
      <pre id="event-log" aria-live="polite"></pre>
    </section>
  `

  wireUpApp(lang, t)
}

function wireUpApp(lang: Language, t: typeof STRINGS['en']) {
  const heroPill = document.querySelector<HTMLDivElement>('#hero-pill')!
  const connectBtn = document.querySelector<HTMLButtonElement>('#connect-btn')!
  const dateInput = document.querySelector<HTMLInputElement>('#date-input')!
  const loadBtn = document.querySelector<HTMLButtonElement>('#load-btn')!
  const hourGrid = document.querySelector<HTMLDivElement>('#hour-grid')!
  const readingCard = document.querySelector<HTMLElement>('#reading-card')!
  const readingSectionEl = document.querySelector<HTMLElement>('#reading-section')!
  const readingProgressEl = document.querySelector<HTMLElement>('#reading-progress')!
  const readingTextEl = document.querySelector<HTMLElement>('#reading-text')!
  const prevBtn = document.querySelector<HTMLButtonElement>('#prev-btn')!
  const nextBtn = document.querySelector<HTMLButtonElement>('#next-btn')!
  const stopReadingBtn = document.querySelector<HTMLButtonElement>('#stop-reading-btn')!
  const scrollModeSelect = document.querySelector<HTMLSelectElement>('#scroll-mode-select')!
  const scrollSpeedInput = document.querySelector<HTMLInputElement>('#scroll-speed-input')!
  const hourToggles = document.querySelector<HTMLDivElement>('#hour-toggles')!
  const logEl = document.querySelector<HTMLPreElement>('#event-log')!
  const clearLogBtn = document.querySelector<HTMLButtonElement>('#clear-log-btn')!
  const refreshAllBtn = document.querySelector<HTMLButtonElement>('#refresh-all-btn')!
  const langBadge = document.querySelector<HTMLSpanElement>('#lang-badge')!
  const prefetchCard = document.querySelector<HTMLElement>('#prefetch-card')!
  const prefetchLabel = document.querySelector<HTMLElement>('#prefetch-label')!
  const prefetchFill = document.querySelector<HTMLElement>('#prefetch-fill')!

  let currentHours: HourInfo[] = []

  function updateHeroPill(phase: LiturgyPhase) {
    const config: Record<LiturgyPhase, { label: string; className: string }> = {
      idle: { label: t.ready, className: 'is-ready' },
      connecting: { label: 'Connecting', className: 'is-connecting' },
      connected: { label: 'Connected', className: 'is-connected' },
      mock: { label: 'Mock', className: 'is-mock' },
      loading: { label: 'Loading', className: 'is-loading' },
      reading: { label: t.reading, className: 'is-reading' },
      error: { label: 'Error', className: 'is-error' },
    }
    const next = config[phase]
    heroPill.textContent = next.label
    heroPill.className = `hero-pill ${next.className}`
  }

  function setPhase(phase: LiturgyPhase) {
    updateHeroPill(phase)
    connectBtn.disabled = phase === 'connecting' || phase === 'loading'
    loadBtn.disabled = phase === 'loading'
    if (phase === 'reading') readingCard.classList.add('visible')
    else readingCard.classList.remove('visible')
  }

  function appendLog(text: string) {
    const time = new Date().toLocaleTimeString()
    logEl.textContent = `[${time}] ${text}\n${logEl.textContent ?? ''}`
    const lines = logEl.textContent.split('\n')
    if (lines.length > 200) logEl.textContent = lines.slice(0, 200).join('\n')
  }

  function hourKeyFromName(name: string): string {
    return name.toLowerCase().replace(/\s+/g, '-').replace(/yesterday's-/, '')
  }

  function renderHourButtons(hours: HourInfo[]) {
    const s = loadSettings()
    hourGrid.innerHTML = hours
      .filter(h => !s.hiddenHours.includes(hourKeyFromName(h.name)))
      .map(h => `<button class="hour-btn" data-slug="${h.slug}" data-date="${(h as any).date || ''}" type="button">${h.name}</button>`)
      .join('')
  }

  function updateReadingView(text: string, progress: string) {
    if (!text && !progress) {
      readingSectionEl.textContent = ''
      readingProgressEl.textContent = ''
      readingTextEl.textContent = ''
      prevBtn.disabled = true
      nextBtn.disabled = true
      return
    }
    readingSectionEl.textContent = t.reading + ' on glasses'
    readingProgressEl.textContent = progress
    readingTextEl.textContent = text || '(view on glasses)'
    prevBtn.disabled = false
    nextBtn.disabled = false
  }

  const controller = createLiturgyController({
    setPhase,
    log: appendLog,
    onReadingChanged: updateReadingView,
    onHoursLoaded(hours) {
      currentHours = hours
      renderHourButtons(hours)
    },
  })

  setPhase('idle')

  // ── Event wiring ──

  connectBtn.addEventListener('click', () => { void controller.connect() })
  loadBtn.addEventListener('click', () => {
    const date = dateInputToApi(dateInput.value)
    void controller.loadHours(date)
  })
  hourGrid.addEventListener('click', (e) => {
    const target = (e.target as HTMLElement).closest<HTMLButtonElement>('.hour-btn')
    if (!target) return
    const slug = target.dataset.slug
    if (slug) {
      hourGrid.querySelectorAll('.hour-btn').forEach(b => b.classList.remove('active'))
      target.classList.add('active')
      void controller.selectHour(slug)
    }
  })
  prevBtn.addEventListener('click', () => controller.scrollUp())
  nextBtn.addEventListener('click', () => controller.scrollDown())
  stopReadingBtn.addEventListener('click', () => controller.stopReading())
  clearLogBtn.addEventListener('click', () => { logEl.textContent = '' })

  const tapAdvanceCheck = document.querySelector<HTMLInputElement>('#tap-advance-check')!
  tapAdvanceCheck.addEventListener('change', () => {
    const s = loadSettings()
    s.tapToAdvance = tapAdvanceCheck.checked
    saveSettings(s)
    appendLog(`Tap to advance: ${s.tapToAdvance ? 'on' : 'off'}`)
  })

  scrollModeSelect.addEventListener('change', () => {
    const s = loadSettings()
    s.scrollMode = scrollModeSelect.value as ScrollMode
    saveSettings(s)
    appendLog(`Scroll mode: ${s.scrollMode}`)
    if (s.scrollMode === 'head-gesture') {
      appendLog('Head gestures: nod down = next, nod up = prev, tilt right = select, tilt left = back')
    }
  })

  scrollSpeedInput.addEventListener('change', () => {
    const val = Number(scrollSpeedInput.value)
    if (val >= 2 && val <= 60) {
      const s = loadSettings()
      s.autoScrollSeconds = val
      saveSettings(s)
      appendLog(`Auto-scroll speed: ${val}s`)
    }
  })

  hourToggles.addEventListener('change', () => {
    const checkboxes = hourToggles.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
    const hidden: string[] = []
    checkboxes.forEach(cb => {
      const key = cb.dataset.hourKey
      if (key && !cb.checked) hidden.push(key)
    })
    const s = loadSettings()
    s.hiddenHours = hidden
    saveSettings(s)
    renderHourButtons(currentHours)
    appendLog(`Updated visible hours`)
  })

  refreshAllBtn.addEventListener('click', async () => {
    const stats = cacheStats()
    clearCache()
    appendLog(`Cleared cache (${stats.entries} entries, ~${Math.round(stats.approxBytes / 1024)} KB)`)
    await runPrefetch(lang)
    // Reload current date after refresh
    void controller.loadHours(dateInputToApi(dateInput.value))
  })

  langBadge.addEventListener('click', async () => {
    const newLang = await showLanguagePicker()
    if (newLang !== lang) {
      setLanguage(newLang)
      location.reload()
    }
  })

  // ── Startup: prefetch the week in the background, auto-load today, connect glasses ──

  async function runPrefetch(l: Language) {
    const dates = nextNDates(7)
    prefetchCard.hidden = false
    prefetchLabel.textContent = 'Downloading week…'
    prefetchFill.style.width = '0%'
    const onProgress = (p: PrefetchProgress) => {
      const pct = p.total > 0 ? Math.round((p.done / p.total) * 100) : 0
      prefetchFill.style.width = `${pct}%`
      prefetchLabel.textContent = `${p.done}/${p.total}${p.failed ? ` (${p.failed} failed)` : ''} · ${p.currentLabel ?? ''}`
    }
    try {
      const result = await prefetchWeek(dates, l, onProgress)
      prefetchLabel.textContent = `${result.done}/${result.total} cached${result.failed ? ` · ${result.failed} failed` : ''}`
      prefetchCard.querySelector('.prefetch-banner')?.classList.add('is-done')
      setTimeout(() => { prefetchCard.hidden = true }, 3000)
    } catch (err) {
      appendLog(`Prefetch error: ${(err as Error).message}`)
    }
  }

  async function startup() {
    // Kick off prefetch & connect in parallel — don't block user interaction on network
    void runPrefetch(lang)
    await Promise.all([
      controller.loadHours(),
      controller.connect(),
    ])
  }
  void startup()
}
