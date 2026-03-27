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

// Conservative page sizing â 7 lines of ~50 chars fits safely
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

function paginateSections(sections: PrayerSection[]): string[] {
  const allLines: string[] = []

  for (const section of sections) {
    if (section.label) {
      allLines.push('')
      allLines.push(`â ${section.label} â`)
      allLines.push('')
    }

    const rawLines = section.text
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0)

    for (const raw of rawLines) {
      allLines.push(...wordWrap(raw, CHARS_PER_LINE))
    }
  }

  const pages: string[] = []
  for (let i = 0; i < allLines.length; i += LINES_PER_PAGE) {
    const pageLines = allLines.slice(i, i + LINES_PER_PAGE)
    pages.push(pageLines.join('\n'))
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

  // ââ Reading layout ââ

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

  // ââ Loading spinner ââ

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

  // ââ Hour list ââ

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

  // ââ Event handling ââ

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

  // ââ Public API ââ

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

  async function loadHours(date?: string): Promise<HourInfo[]> {
    if (date) state.date = date
    publishPhase('loading')
    log(`Loading hours for ${state.date}...`)

    try {
      const index = await fetchHours(state.date)
      state.hours = index.hours
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
