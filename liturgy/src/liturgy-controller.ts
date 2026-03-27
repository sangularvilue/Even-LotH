import {
  CreateStartUpPageContainer,
  ListContainerProperty,
  ListItemContainerProperty,
  OsEventTypeList,
  RebuildPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
  waitForEvenAppBridge,
  type EvenAppBridge,
} from '@evenrealities/even_hub_sdk'
import { withTimeout } from './shared/async'
import { getRawEventType, normalizeEventType } from './shared/even-events'
import { fetchHours, fetchHour } from './api-client'
import { loadSettings } from './settings'
import type { HourInfo, LiturgyPhase, PrayerSection } from './types'

type ControllerDeps = {
  setPhase?: (phase: LiturgyPhase) => void
  log: (text: string) => void
  onReadingChanged?: (text: string, progress: string) => void
  onHoursLoaded?: (hours: HourInfo[]) => void
}

type GlassesView = 'hours' | 'loading' | 'reading'

type ControllerState = {
  bridge: EvenAppBridge | null
  startupRendered: boolean
  eventLoopRegistered: boolean
  mode: 'bridge' | 'mock' | null
  view: GlassesView
  date: string
  hours: HourInfo[]
  selectedHourIndex: number
  pages: string[]
  pageIndex: number
}

const DISPLAY_WIDTH = 576
const TEXT_HEIGHT = 256
const BAR_HEIGHT = 30

// Conservative page sizing — 7 lines of ~50 chars fits safely
const CHARS_PER_LINE = 50
const LINES_PER_PAGE = 7

function todayDateStr(): string {
  const d = new Date()
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

function wordWrap(text: string, maxWidth: number): string[] {
  if (text.length <= maxWidth) return [text]
  const result: string[] = []
  const words = text.split(' ')
  let current = ''
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (candidate.length > maxWidth && current) {
      result.push(current)
      current = word
    } else {
      current = candidate
    }
  }
  if (current) result.push(current)
  return result.length > 0 ? result : [text]
}

// ── Junk lines to strip from intro ──
const INTRO_JUNK = [
  /general instruction/i,
  /please pray with us/i,
  /joining with us in saying/i,
  /indicated in this/i,
  /consider an examination/i,
  /best make use of our time/i,
  /\[highlight\]/i,
  /\[\.?\]/,
  /^\[Night Prayer/i,
  /^\[Morning Prayer/i,
  /^\[Evening Prayer/i,
  /^\[Office of Readings/i,
  /^\[Midmorning Prayer/i,
  /^\[Midday Prayer/i,
  /^\[Midafternoon Prayer/i,
  /^\[Invitatory/i,
]

function isIntroJunk(line: string): boolean {
  return INTRO_JUNK.some(re => re.test(line))
}

/**
 * Convert semantic markers to plain text and reformat psalm/canticle headers.
 *
 * Psalm headers become:
 *   Psalm 16 - God is my portion, my inheritance.
 *   (The Father raised up Jesus...) - Acts 2:24
 *
 * Returns { text, isNewSection } where isNewSection forces a page break.
 */
function formatLines(rawLines: string[]): { text: string; pageBreak: boolean }[] {
  const result: { text: string; pageBreak: boolean }[] = []
  let i = 0

  while (i < rawLines.length) {
    let line = rawLines[i]!

    // Strip intro junk
    if (isIntroJunk(line)) { i++; continue }

    // Detect psalm/canticle title patterns:
    //   Pattern A (single line): {r}Psalm 16 - subtitle{/r}
    //   Pattern B (split across lines):
    //     {r}Psalm 16
    //     God is my portion, my inheritance{/r}
    //   Followed optionally by: {i}cross-reference{/i} (Book X:Y).

    // Pattern A: complete on one line
    const titleMatchA = line.match(/^\{r\}((?:Psalm|Canticle)\s+[^{]*)\{\/r\}$/i)
    // Pattern B: opening {r} with psalm/canticle, no closing
    const titleMatchB = line.match(/^\{r\}((?:Psalm|Canticle)\s+\d+[^{]*)$/i)

    if (titleMatchA || titleMatchB) {
      let title: string
      let subtitle = ''

      if (titleMatchA) {
        // May contain title + subtitle separated by newline within the {r} block
        const parts = titleMatchA[1].trim().split('\n').map(p => p.trim()).filter(Boolean)
        title = parts[0]!
        subtitle = parts.slice(1).join(' ')
      } else {
        // Pattern B: title on this line, subtitle on next line ending with {/r}
        title = titleMatchB![1].trim()
        if (i + 1 < rawLines.length) {
          const nextLine = rawLines[i + 1]!
          const closingMatch = nextLine.match(/^(.+?)\{\/r\}$/)
          if (closingMatch) {
            subtitle = closingMatch[1].trim()
            i++
          }
        }
      }

      // Check if next line is also a red subtitle
      if (!subtitle && i + 1 < rawLines.length) {
        const nextMatch = rawLines[i + 1]!.match(/^\{r\}(.+?)\{\/r\}$/)
        if (nextMatch && !/^(HYMN|PSALMODY|READING|RESPONSORY|INTERCESSIONS|CONCLUDING|DISMISSAL|CANTICLE OF)/i.test(nextMatch[1])) {
          subtitle = nextMatch[1].trim()
          i++
        }
      }

      let headerLine = subtitle ? `${title} - ${subtitle}` : title

      // Check if next line is a cross-reference
      let crossRef = ''
      if (i + 1 < rawLines.length) {
        const refMatch = rawLines[i + 1]!.match(/^\{i\}(.+?)\{\/i\}\s*(\([^)]+\))?\.?$/)
        if (refMatch) {
          crossRef = `(${refMatch[1]}) - ${refMatch[2] || ''}`.replace(/ - $/, '')
          i++
        }
      }

      result.push({ text: headerLine, pageBreak: true })
      if (crossRef) result.push({ text: crossRef, pageBreak: false })
      result.push({ text: '', pageBreak: false })
      i++
      continue
    }

    // Detect section headings: {r}READING{/r}, {r}HYMN{/r} etc.
    const sectionMatch = line.match(/^\{r\}([A-Z][A-Z\s\d:,\-]+)\{\/r\}$/)
    if (sectionMatch) {
      const heading = sectionMatch[1].trim()
      // READING often has a reference on the same line or next
      result.push({ text: `== ${heading} ==`, pageBreak: true })
      i++
      continue
    }

    // Format remaining markers
    let formatted = line
      // Bracketed instructions like [Psalm-prayer]
      .replace(/\{r\}\[([^\]]+)\]\{\/r\}/g, '[$1]')
      // Other rubrics -> brackets
      .replace(/\{r\}(.+?)\{\/r\}/g, '[$1]')
      // Response marker
      .replace(/\{v\}\u2014\{\/v\}\s*/g, 'R/ ')
      // Antiphon labels
      .replace(/\{ant\}(Ant\.?\s*\d*)\{\/ant\}\s*/g, '* $1 ')
      // Italic cross-references -> parens
      .replace(/\{i\}(.+?)\{\/i\}/g, '($1)')
      // Title blocks
      .replace(/\{title\}(.+?)\{\/title\}/g, '$1')
      // Clean remaining markers
      .replace(/\{\/?\w+\}/g, '')

    // Skip empty after cleanup
    if (!formatted.trim()) { i++; continue }

    // Antiphons get spacing
    const isAntiphon = formatted.startsWith('* Ant')
    // Confiteor / penitential rite get a break before
    const isPrayerStart = /^(I confess to almighty God|Lord Jesus|God, come to my assistance)/.test(formatted)

    if (isAntiphon || isPrayerStart) {
      result.push({ text: '', pageBreak: false })
    }

    result.push({ text: formatted, pageBreak: false })

    if (isAntiphon) {
      result.push({ text: '', pageBreak: false })
    }

    i++
  }

  return result
}

function paginateSections(sections: PrayerSection[]): string[] {
  // Build all formatted lines with page break markers
  const entries: { text: string; pageBreak: boolean }[] = []

  for (const section of sections) {
    if (section.label) {
      entries.push({ text: '', pageBreak: false })
      entries.push({ text: `== ${section.label} ==`, pageBreak: true })
      entries.push({ text: '', pageBreak: false })
    }

    const rawLines = section.text
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0)

    entries.push(...formatLines(rawLines))
  }

  // Paginate — respect page breaks and LINES_PER_PAGE limit
  const pages: string[] = []
  let currentPage: string[] = []

  for (const entry of entries) {
    if (entry.pageBreak && currentPage.some(l => l.trim().length > 0)) {
      // Flush current page
      pages.push(currentPage.join('\n'))
      currentPage = []
    }

    const wrapped = entry.text === '' ? [''] : wordWrap(entry.text, CHARS_PER_LINE)
    for (const wline of wrapped) {
      if (currentPage.length >= LINES_PER_PAGE && currentPage.some(l => l.trim().length > 0)) {
        pages.push(currentPage.join('\n'))
        currentPage = []
      }
      currentPage.push(wline)
    }
  }

  // Flush remaining
  if (currentPage.some(l => l.trim().length > 0)) {
    pages.push(currentPage.join('\n'))
  }

  return pages.length > 0 ? pages : ['(empty)']
}

export function createLiturgyController({ setPhase, log, onReadingChanged, onHoursLoaded }: ControllerDeps) {
  const state: ControllerState = {
    bridge: null,
    startupRendered: false,
    eventLoopRegistered: false,
    mode: null,
    view: 'hours',
    date: todayDateStr(),
    hours: [],
    selectedHourIndex: 0,
    pages: [],
    pageIndex: 0,
  }

  let currentLayout: 'hours' | 'reading' | 'loading' | null = null
  let spinnerIntervalId: number | null = null

  function publishPhase(phase: LiturgyPhase): void {
    setPhase?.(phase)
  }

  function visibleHours(): HourInfo[] {
    const settings = loadSettings()
    return state.hours.filter(h => !settings.hiddenHours.includes(h.slug))
  }

  function progressStr(): string {
    if (state.pages.length <= 1) return '100%'
    return `${state.pageIndex + 1}/${state.pages.length}`
  }

  function progressBar(): string {
    const barLen = 30
    const progress = state.pages.length > 1
      ? (state.pageIndex + 1) / state.pages.length
      : 1
    const filled = Math.round(barLen * progress)
    return '\u2501'.repeat(filled) + '\u2500'.repeat(barLen - filled)
  }

  // ── Reading layout ──

  async function setupReadingLayout(): Promise<void> {
    const bridge = state.bridge
    if (!bridge) return

    stopSpinner()

    const page = state.pages[state.pageIndex] ?? ''

    const textContainer = new TextContainerProperty({
      containerID: 1,
      containerName: 'lit-reading',
      content: page,
      xPosition: 0,
      yPosition: 0,
      width: DISPLAY_WIDTH,
      height: TEXT_HEIGHT,
      borderWidth: 0,
      paddingLength: 6,
      isEventCapture: 1,
    })

    const footerContainer = new TextContainerProperty({
      containerID: 2,
      containerName: 'lit-footer',
      content: progressBar(),
      xPosition: 0,
      yPosition: TEXT_HEIGHT,
      width: DISPLAY_WIDTH,
      height: BAR_HEIGHT,
      borderWidth: 0,
      paddingLength: 0,
      isEventCapture: 0,
    })

    const config = {
      containerTotalNum: 2,
      textObject: [textContainer, footerContainer],
    }

    try {
      if (!state.startupRendered) {
        await bridge.createStartUpPageContainer(new CreateStartUpPageContainer(config))
        state.startupRendered = true
      } else {
        await bridge.rebuildPageContainer(new RebuildPageContainer(config))
      }
      currentLayout = 'reading'
    } catch (err) {
      log(`setupReadingLayout error: ${err}`)
    }
  }

  async function updatePageText(): Promise<void> {
    const bridge = state.bridge
    if (!bridge || currentLayout !== 'reading') return

    const content = state.pages[state.pageIndex] ?? ''
    const bar = progressBar()
    try {
      await bridge.textContainerUpgrade(new TextContainerUpgrade({
        containerID: 1,
        containerName: 'lit-reading',
        contentOffset: 0,
        contentLength: content.length,
        content,
      }))
      await bridge.textContainerUpgrade(new TextContainerUpgrade({
        containerID: 2,
        containerName: 'lit-footer',
        contentOffset: 0,
        contentLength: bar.length,
        content: bar,
      }))
    } catch (err) {
      log(`updatePageText error: ${err}`)
    }
  }

  // ── Loading spinner ──

  function stopSpinner(): void {
    if (spinnerIntervalId !== null) {
      window.clearInterval(spinnerIntervalId)
      spinnerIntervalId = null
    }
  }

  async function renderLoadingPage(hourName: string): Promise<void> {
    const bridge = state.bridge
    if (!bridge) return

    stopSpinner()

    const frames = ['|', '/', '-', '\\']
    let frameIdx = 0

    const spinnerText = new TextContainerProperty({
      containerID: 1,
      containerName: 'lit-loading',
      content: `Loading ${hourName}...  ${frames[0]}`,
      xPosition: 8,
      yPosition: 100,
      width: 560,
      height: 40,
      isEventCapture: 0,
    })

    const captureList = new ListContainerProperty({
      containerID: 2,
      containerName: 'lit-load-cap',
      itemContainer: new ListItemContainerProperty({
        itemCount: 3,
        itemWidth: 1,
        isItemSelectBorderEn: 0,
        itemName: [' ', ' ', ' '],
      }),
      isEventCapture: 1,
      xPosition: 0,
      yPosition: 0,
      width: 1,
      height: 1,
    })

    const config = {
      containerTotalNum: 2,
      textObject: [spinnerText],
      listObject: [captureList],
    }

    if (!state.startupRendered) {
      await bridge.createStartUpPageContainer(new CreateStartUpPageContainer(config))
      state.startupRendered = true
    } else {
      await bridge.rebuildPageContainer(new RebuildPageContainer(config))
    }
    currentLayout = 'loading'

    spinnerIntervalId = window.setInterval(async () => {
      frameIdx = (frameIdx + 1) % frames.length
      const content = `Loading ${hourName}...  ${frames[frameIdx]}`
      try {
        await bridge.textContainerUpgrade(new TextContainerUpgrade({
          containerID: 1,
          containerName: 'lit-loading',
          contentOffset: 0,
          contentLength: content.length,
          content,
        }))
      } catch { /* ignore */ }
    }, 250)
  }

  // ── Hour list ──

  async function renderHourListPage(): Promise<void> {
    const bridge = state.bridge
    if (!bridge) return

    const hours = visibleHours()
    if (hours.length === 0) {
      log('[glasses] no visible hours')
      return
    }

    stopSpinner()

    const titleText = new TextContainerProperty({
      containerID: 1,
      containerName: 'lit-title',
      content: 'Liturgy of the Hours',
      xPosition: 8,
      yPosition: 0,
      width: 560,
      height: 32,
      isEventCapture: 0,
    })

    const hourList = new ListContainerProperty({
      containerID: 2,
      containerName: 'lit-hour-list',
      itemContainer: new ListItemContainerProperty({
        itemCount: hours.length,
        itemWidth: 556,
        isItemSelectBorderEn: 1,
        itemName: hours.map(h => h.name),
      }),
      isEventCapture: 1,
      xPosition: 8,
      yPosition: 40,
      width: 560,
      height: 248,
    })

    const config = {
      containerTotalNum: 2,
      textObject: [titleText],
      listObject: [hourList],
    }

    if (!state.startupRendered) {
      await bridge.createStartUpPageContainer(new CreateStartUpPageContainer(config))
      state.startupRendered = true
    } else {
      await bridge.rebuildPageContainer(new RebuildPageContainer(config))
    }
    currentLayout = 'hours'
  }

  // ── Event handling ──

  function registerEventLoop(bridge: EvenAppBridge): void {
    if (state.eventLoopRegistered) return

    bridge.onEvenHubEvent(async (event) => {
      const rawEventType = getRawEventType(event)
      let eventType = normalizeEventType(rawEventType, OsEventTypeList)

      const incomingIndexRaw = event.listEvent?.currentSelectItemIndex
      const incomingIndex = typeof incomingIndexRaw === 'number'
        ? incomingIndexRaw
        : typeof incomingIndexRaw === 'string'
          ? Number.parseInt(incomingIndexRaw, 10)
          : -1

      if (eventType === undefined && event.listEvent) {
        if (incomingIndex >= 0 && incomingIndex !== state.selectedHourIndex) {
          eventType = incomingIndex > state.selectedHourIndex
            ? OsEventTypeList.SCROLL_BOTTOM_EVENT
            : OsEventTypeList.SCROLL_TOP_EVENT
        } else {
          eventType = OsEventTypeList.CLICK_EVENT
        }
      }

      if (state.view === 'loading') return

      if (state.view === 'hours') {
        await onHourListEvent(eventType, incomingIndex)
      } else if (state.view === 'reading') {
        await onReadingEvent(eventType)
      }
    })

    state.eventLoopRegistered = true
  }

  async function onHourListEvent(eventType: number | undefined, incomingIndex: number): Promise<void> {
    const hours = visibleHours()
    if (hours.length === 0) return

    if (eventType === OsEventTypeList.SCROLL_TOP_EVENT || eventType === OsEventTypeList.SCROLL_BOTTOM_EVENT) {
      const delta = eventType === OsEventTypeList.SCROLL_TOP_EVENT ? -1 : 1
      if (incomingIndex >= 0 && incomingIndex < hours.length) {
        state.selectedHourIndex = incomingIndex
      } else {
        state.selectedHourIndex = clamp(state.selectedHourIndex + delta, 0, hours.length - 1)
      }
      log(`Selected: ${hours[state.selectedHourIndex]?.name}`)
      return
    }

    if (eventType === OsEventTypeList.CLICK_EVENT) {
      const idx = (incomingIndex >= 0 && incomingIndex < hours.length)
        ? incomingIndex
        : state.selectedHourIndex
      const hour = hours[idx]
      if (!hour) return

      state.selectedHourIndex = idx
      state.view = 'loading'
      publishPhase('loading')

      await renderLoadingPage(hour.name)
      log(`Loading ${hour.name}...`)

      try {
        const content = await fetchHour(hour.slug, hour.date || state.date)

        stopSpinner()

        state.pages = paginateSections(content.sections)
        state.pageIndex = 0
        state.view = 'reading'
        publishPhase('reading')
        log(`${hour.name}: ${state.pages.length} pages`)

        await setupReadingLayout()
      } catch (err) {
        stopSpinner()
        log(`Error: ${err}`)
        state.view = 'hours'
        publishPhase('error')
        await renderHourListPage()
      }
    }
  }

  async function onReadingEvent(eventType: number | undefined): Promise<void> {
    if (eventType === OsEventTypeList.DOUBLE_CLICK_EVENT) {
      state.pages = []
      state.pageIndex = 0
      state.view = 'hours'
      onReadingChanged?.('', '')
      publishPhase(state.mode === 'mock' ? 'mock' : 'connected')
      log('Back to hour list')
      await renderHourListPage()
      return
    }

    // Tap advances to next page
    if (eventType === OsEventTypeList.CLICK_EVENT) {
      if (state.pageIndex < state.pages.length - 1) {
        state.pageIndex++
        await updatePageText()
        onReadingChanged?.('', progressStr())
      } else {
        log('Reached end')
      }
      return
    }

    // Swipe scrolls pages
    if (eventType === OsEventTypeList.SCROLL_BOTTOM_EVENT) {
      if (state.pageIndex < state.pages.length - 1) {
        state.pageIndex++
        await updatePageText()
        onReadingChanged?.('', progressStr())
      }
    } else if (eventType === OsEventTypeList.SCROLL_TOP_EVENT) {
      if (state.pageIndex > 0) {
        state.pageIndex--
        await updatePageText()
        onReadingChanged?.('', progressStr())
      }
    }
  }

  // ── Public API ──

  async function connect(): Promise<void> {
    publishPhase('connecting')
    log('Connecting to glasses...')

    try {
      if (!state.bridge) {
        state.bridge = await withTimeout(waitForEvenAppBridge(), 6000)
      }
      state.mode = 'bridge'
      registerEventLoop(state.bridge)
      publishPhase('connected')
      log('Connected to glasses')

      if (state.hours.length > 0) {
        await renderHourListPage()
      }
    } catch {
      state.mode = 'mock'
      publishPhase('mock')
      log('Bridge not found, mock mode')
    }
  }

  function prevDateStr(dateStr: string): string {
    const y = parseInt(dateStr.slice(0, 4))
    const m = parseInt(dateStr.slice(4, 6)) - 1
    const d = parseInt(dateStr.slice(6, 8))
    const prev = new Date(y, m, d - 1)
    return `${prev.getFullYear()}${String(prev.getMonth() + 1).padStart(2, '0')}${String(prev.getDate()).padStart(2, '0')}`
  }

  async function loadHours(date?: string): Promise<HourInfo[]> {
    if (date) state.date = date
    publishPhase('loading')
    log(`Loading hours for ${state.date}...`)

    try {
      const [index, yesterdayIndex] = await Promise.all([
        fetchHours(state.date),
        fetchHours(prevDateStr(state.date)).catch(() => null),
      ])

      state.hours = [...index.hours]

      // Add yesterday's Evening Prayer and Night Prayer for night workers
      if (yesterdayIndex?.hours) {
        const yesterdayEP = yesterdayIndex.hours.find(h =>
          h.name.toLowerCase().includes('evening prayer'))
        const yesterdayNP = yesterdayIndex.hours.find(h =>
          h.name.toLowerCase().includes('night prayer'))
        if (yesterdayEP) {
          state.hours.push({ ...yesterdayEP, name: `Yesterday's Evening Prayer` })
        }
        if (yesterdayNP) {
          state.hours.push({ ...yesterdayNP, name: `Yesterday's Night Prayer` })
        }
      }

      state.selectedHourIndex = 0
      onHoursLoaded?.(state.hours)
      log(`Loaded ${state.hours.length} hours`)
      publishPhase(state.mode === 'mock' ? 'mock' : state.mode === 'bridge' ? 'connected' : 'idle')

      if (state.bridge && state.hours.length > 0) {
        state.view = 'hours'
        await renderHourListPage()
      }

      return state.hours
    } catch (err) {
      log(`Error loading hours: ${err}`)
      publishPhase('error')
      return []
    }
  }

  async function selectHour(slug: string): Promise<void> {
    const hour = state.hours.find(h => h.slug === slug)
    const hourName = hour?.name ?? slug

    state.view = 'loading'
    publishPhase('loading')
    if (state.bridge) await renderLoadingPage(hourName)
    log(`Loading ${hourName}...`)

    try {
      const content = await fetchHour(slug, hour?.date || state.date)

      stopSpinner()

      state.pages = paginateSections(content.sections)
      state.pageIndex = 0
      state.view = 'reading'
      publishPhase('reading')
      log(`${content.name}: ${state.pages.length} pages`)

      if (state.bridge) {
        await setupReadingLayout()
      }
    } catch (err) {
      stopSpinner()
      log(`Error: ${err}`)
      publishPhase('error')
    }
  }

  function stopReading(): void {
    stopSpinner()
    state.pages = []
    state.pageIndex = 0
    state.view = 'hours'
    onReadingChanged?.('', '')
    publishPhase(state.mode === 'mock' ? 'mock' : state.mode === 'bridge' ? 'connected' : 'idle')
    if (state.bridge) void renderHourListPage()
    log('Stopped reading')
  }

  return {
    connect,
    loadHours,
    selectHour,
    stopReading,
    getState: () => ({ ...state }),
  }
}
