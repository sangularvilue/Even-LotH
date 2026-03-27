import './styles.css'
import QRCode from 'qrcode'
import { createLiturgyController } from './liturgy-controller'
import { loadSettings, saveSettings } from './settings'
import type { LiturgyPhase, HourInfo, ScrollMode } from './types'

const ALL_HOURS = [
  { key: 'invitatory', label: 'Invitatory' },
  { key: 'office-of-readings', label: 'Office of Readings' },
  { key: 'morning-prayer', label: 'Morning Prayer' },
  { key: 'midmorning-prayer', label: 'Midmorning Prayer' },
  { key: 'midday-prayer', label: 'Midday Prayer' },
  { key: 'midafternoon-prayer', label: 'Midafternoon Prayer' },
  { key: 'evening-prayer', label: 'Evening Prayer' },
  { key: 'night-prayer', label: 'Night Prayer' },
]

const app = document.querySelector<HTMLDivElement>('#app')
if (!app) throw new Error('Missing #app')

function todayInputValue(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function dateInputToApi(val: string): string {
  return val.replace(/-/g, '')
}

const settings = loadSettings()

app.innerHTML = `
  <header class="hero card">
    <div>
      <p class="eyebrow">Even G2</p>
      <h1 class="page-title">Liturgy of the Hours</h1>
      <p class="page-subtitle">Divine Office prayer reader for glasses</p>
    </div>
    <div id="hero-pill" class="hero-pill is-ready" aria-live="polite">Ready</div>
  </header>

  <section id="install-card" class="card" style="text-align:center">
    <p class="section-label">Install on Even G2</p>
    <div id="qr-container" style="margin:12px auto;width:200px;height:200px;background:#f0f0f0;border-radius:8px;display:flex;align-items:center;justify-content:center">
      <span class="hint">Loading QR...</span>
    </div>
    <p class="hint" style="margin-top:8px">Scan this QR code in the <strong>Even Hub</strong> section of the app</p>
  </section>

  <section class="card">
    <div class="top-actions">
      <button id="connect-btn" class="btn btn-primary connect-glasses-btn" type="button">Connect glasses</button>
    </div>
  </section>

  <section class="card">
    <p class="section-label">Date & Hours</p>
    <div class="date-row">
      <input id="date-input" class="date-input" type="date" value="${todayInputValue()}" />
      <button id="load-btn" class="btn btn-primary compact" type="button">
        <span class="btn-title">Load</span>
      </button>
    </div>
    <div id="hour-grid" class="hour-grid"></div>
  </section>

  <section id="reading-card" class="reading-card card">
    <p class="section-label">Reading</p>
    <div class="reading-header">
      <span id="reading-section" class="reading-section-label"></span>
      <span id="reading-progress" class="reading-progress"></span>
    </div>
    <div id="reading-text" class="reading-text"></div>
    <div class="reading-nav">
      <button id="prev-btn" class="btn" type="button">
        <span class="btn-title">Prev</span>
      </button>
      <button id="next-btn" class="btn" type="button">
        <span class="btn-title">Next</span>
      </button>
      <button id="stop-reading-btn" class="btn btn-ghost" type="button">
        <span class="btn-title">Stop</span>
      </button>
    </div>
  </section>

  <section class="card">
    <p class="section-label">Settings</p>
    <div class="settings-grid">
      <div class="setting-row">
        <span class="setting-label">Scroll mode</span>
        <select id="scroll-mode-select" class="setting-select">
          <option value="manual" ${settings.scrollMode === 'manual' ? 'selected' : ''}>Manual</option>
          <option value="auto" ${settings.scrollMode === 'auto' ? 'selected' : ''}>Auto-scroll</option>
        </select>
      </div>
      <div class="setting-row">
        <span class="setting-label">Tap to advance</span>
        <label class="hour-toggle"><input id="tap-advance-check" type="checkbox" ${settings.tapToAdvance ? 'checked' : ''} /> Enabled</label>
      </div>
      <div class="setting-row">
        <span class="setting-label">Seconds per page</span>
        <input id="scroll-speed-input" class="setting-input" type="number" min="2" max="60" step="1" value="${settings.autoScrollSeconds}" style="width:70px" />
      </div>
      <div class="setting-row">
        <span class="setting-label">Font size (px)</span>
        <input id="font-size-input" class="setting-input" type="number" min="10" max="28" step="1" value="${settings.fontSize}" style="width:70px" />
      </div>
      <div class="setting-row">
        <span class="setting-label">Font weight</span>
        <input id="font-weight-input" class="setting-input" type="number" min="100" max="900" step="50" value="${settings.fontWeight}" style="width:70px" />
      </div>
      <div class="setting-row">
        <span class="setting-label">Letter spacing (px)</span>
        <input id="letter-spacing-input" class="setting-input" type="number" min="0" max="3" step="0.1" value="${settings.letterSpacing}" style="width:70px" />
      </div>
      <div class="setting-row">
        <span class="setting-label">Display columns</span>
        <select id="display-cols-select" class="setting-select">
          <option value="1" ${settings.displayColumns === 1 ? 'selected' : ''}>1 (narrow, tall)</option>
          <option value="2" ${settings.displayColumns === 2 ? 'selected' : ''}>2 (wide)</option>
        </select>
      </div>
      <div>
        <span class="setting-label">Visible hours</span>
        <div id="hour-toggles" class="hour-toggle-grid">
          ${ALL_HOURS.map(h => `
            <label class="hour-toggle">
              <input type="checkbox" data-hour-key="${h.key}" ${settings.hiddenHours.includes(h.key) ? '' : 'checked'} />
              ${h.label}
            </label>
          `).join('')}
        </div>
      </div>
    </div>
  </section>

  <section class="card">
    <p class="section-label">Glasses Controls</p>
    <p class="hint">Hour list: Scroll to navigate, Tap to select. Reading: Tap to advance page (if enabled), Scroll up/down to change page, Double-tap to go back.</p>
  </section>

  <section class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
      <p class="log-title" style="margin:0">Event Log</p>
      <button id="clear-log-btn" class="btn btn-ghost compact" type="button" style="padding:4px 10px;font-size:0.72rem">
        <span class="btn-title">Clear</span>
      </button>
    </div>
    <pre id="event-log" aria-live="polite"></pre>
  </section>
`

// ── Element refs ──

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
const fontSizeInput = document.querySelector<HTMLInputElement>('#font-size-input')!
const fontWeightInput = document.querySelector<HTMLInputElement>('#font-weight-input')!
const letterSpacingInput = document.querySelector<HTMLInputElement>('#letter-spacing-input')!
const displayColsSelect = document.querySelector<HTMLSelectElement>('#display-cols-select')!
const hourToggles = document.querySelector<HTMLDivElement>('#hour-toggles')!
const logEl = document.querySelector<HTMLPreElement>('#event-log')!
const clearLogBtn = document.querySelector<HTMLButtonElement>('#clear-log-btn')!

// ── State ──

let currentHours: HourInfo[] = []

// ── UI helpers ──

function updateHeroPill(phase: LiturgyPhase): void {
  const config: Record<LiturgyPhase, { label: string; className: string }> = {
    idle: { label: 'Ready', className: 'is-ready' },
    connecting: { label: 'Connecting', className: 'is-connecting' },
    connected: { label: 'Connected', className: 'is-connected' },
    mock: { label: 'Mock Mode', className: 'is-mock' },
    loading: { label: 'Loading', className: 'is-loading' },
    reading: { label: 'Reading', className: 'is-reading' },
    error: { label: 'Error', className: 'is-error' },
  }
  const next = config[phase]
  heroPill.textContent = next.label
  heroPill.className = `hero-pill ${next.className}`
}

function setPhase(phase: LiturgyPhase): void {
  updateHeroPill(phase)
  connectBtn.disabled = phase === 'connecting' || phase === 'loading'
  loadBtn.disabled = phase === 'loading'

  if (phase === 'reading') {
    readingCard.classList.add('visible')
  } else {
    readingCard.classList.remove('visible')
  }
}

function appendLog(text: string): void {
  const time = new Date().toLocaleTimeString()
  logEl.textContent = `[${time}] ${text}\n${logEl.textContent ?? ''}`
  const lines = logEl.textContent.split('\n')
  if (lines.length > 200) {
    logEl.textContent = lines.slice(0, 200).join('\n')
  }
}

function renderHourButtons(hours: HourInfo[]): void {
  const settings = loadSettings()
  hourGrid.innerHTML = hours
    .filter(h => !settings.hiddenHours.includes(h.slug))
    .map(h => `<button class="hour-btn" data-slug="${h.slug}" type="button">${h.name}</button>`)
    .join('')
}

function updateReadingView(text: string, progress: string): void {
  if (!text && !progress) {
    readingSectionEl.textContent = ''
    readingProgressEl.textContent = ''
    readingTextEl.textContent = ''
    prevBtn.disabled = true
    nextBtn.disabled = true
    return
  }

  readingSectionEl.textContent = 'Reading on glasses'
  readingProgressEl.textContent = progress
  readingTextEl.textContent = text || '(view on glasses)'
  prevBtn.disabled = false
  nextBtn.disabled = false
}

// ── Controller ──

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

connectBtn.addEventListener('click', () => {
  void controller.connect()
})

loadBtn.addEventListener('click', () => {
  const date = dateInputToApi(dateInput.value)
  void controller.loadHours(date)
})

hourGrid.addEventListener('click', (e) => {
  const target = (e.target as HTMLElement).closest<HTMLButtonElement>('.hour-btn')
  if (!target) return
  const slug = target.dataset.slug
  if (slug) {
    // Highlight active
    hourGrid.querySelectorAll('.hour-btn').forEach(b => b.classList.remove('active'))
    target.classList.add('active')
    void controller.selectHour(slug)
  }
})

prevBtn.addEventListener('click', () => controller.scrollUp())
nextBtn.addEventListener('click', () => controller.scrollDown())
stopReadingBtn.addEventListener('click', () => controller.stopReading())

clearLogBtn.addEventListener('click', () => {
  logEl.textContent = ''
})

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

fontSizeInput.addEventListener('change', () => {
  const val = Number(fontSizeInput.value)
  if (val >= 10 && val <= 28) {
    const s = loadSettings()
    s.fontSize = val
    saveSettings(s)
    appendLog(`Font size: ${val}px`)
  }
})

fontWeightInput.addEventListener('change', () => {
  const val = Number(fontWeightInput.value)
  if (val >= 100 && val <= 900) {
    const s = loadSettings()
    s.fontWeight = val
    saveSettings(s)
    appendLog(`Font weight: ${val}`)
  }
})

letterSpacingInput.addEventListener('change', () => {
  const val = Number(letterSpacingInput.value)
  if (val >= 0 && val <= 3) {
    const s = loadSettings()
    s.letterSpacing = val
    saveSettings(s)
    appendLog(`Letter spacing: ${val}px`)
  }
})

displayColsSelect.addEventListener('change', () => {
  const val = Number(displayColsSelect.value) as 1 | 2
  const s = loadSettings()
  s.displayColumns = val
  saveSettings(s)
  appendLog(`Display columns: ${val}`)
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

// ── QR code ──

async function generateQR(): Promise<void> {
  const container = document.querySelector<HTMLDivElement>('#qr-container')
  if (!container) return

  const url = window.location.origin
  try {
    const canvas = document.createElement('canvas')
    await QRCode.toCanvas(canvas, url, { width: 200, margin: 2 })
    canvas.style.borderRadius = '8px'
    container.innerHTML = ''
    container.appendChild(canvas)
  } catch {
    container.innerHTML = `<span class="hint">${url}</span>`
  }
}

// Auto-connect and auto-load on startup
async function startup() {
  void generateQR()
  await Promise.all([
    controller.loadHours(),
    controller.connect(),
  ])
}
void startup()
