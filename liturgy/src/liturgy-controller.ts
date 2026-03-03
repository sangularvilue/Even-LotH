import {
  CreateStartUpPageContainer,
  ImageContainerProperty,
  ImageRawDataUpdate,
  ListContainerProperty,
  ListItemContainerProperty,
  OsEventTypeList,
  RebuildPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
  waitForEvenAppBridge,
  type EvenAppBridge,
} from '@evenrealities/even_hub_sdk'
import { withTimeout } from '../../_shared/async'
import { getRawEventType, normalizeEventType } from '../../_shared/even-events'
import { fetchHours, fetchHour } from './api-client'
import { PrayerCanvas, computeTileLayout, type TileLayout } from './prayer-canvas'
import { loadSettings } from './settings'
import type { HourInfo, LiturgyPhase } from './types'

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
  // Image-based scroll state
  prayerCanvas: PrayerCanvas | null
  tileLayout: TileLayout | null
  scrollY: number
  scrollTimerId: number | null
  scrollPaused: boolean
  sending: boolean
}

const DISPLAY_WIDTH = 576

function todayDateStr(): string {
  const d = new Date()
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
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
    prayerCanvas: null,
    tileLayout: null,
    scrollY: 0,
    scrollTimerId: null,
    scrollPaused: false,
    sending: false,
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

  function maxScrollY(): number {
    return state.prayerCanvas?.maxScroll ?? 0
  }

  function progressStr(): string {
    const max = maxScrollY()
    if (max <= 0) return '100%'
    return `${Math.round((state.scrollY / max) * 100)}%`
  }

  // ── Image-based reading ──

  async function setupReadingLayout(): Promise<void> {
    const bridge = state.bridge
    const layout = state.tileLayout
    if (!bridge || !layout) return

    stopSpinner()

    // Center the image grid on the display
    const gridWidth = layout.cols * layout.tileWidth
    const gridHeight = layout.rows * layout.tileHeight
    const offsetX = Math.floor((DISPLAY_WIDTH - gridWidth) / 2)
    const offsetY = Math.floor((288 - gridHeight) / 2)

    const images: ImageContainerProperty[] = []
    for (let row = 0; row < layout.rows; row++) {
      for (let col = 0; col < layout.cols; col++) {
        const idx = row * layout.cols + col
        images.push(new ImageContainerProperty({
          containerID: idx + 1,
          containerName: `lit-img-${idx}`,
          xPosition: offsetX + col * layout.tileWidth,
          yPosition: offsetY + row * layout.tileHeight,
          width: layout.tileWidth,
          height: layout.tileHeight,
        }))
      }
    }

    const config: any = {
      containerTotalNum: layout.totalTiles + (layout.hasEventCapture ? 1 : 0),
      imageObject: images,
    }

    if (layout.hasEventCapture) {
      config.listObject = [new ListContainerProperty({
        containerID: layout.totalTiles + 1,
        containerName: 'lit-r-cap',
        itemContainer: new ListItemContainerProperty({
          itemCount: 20,
          itemWidth: 1,
          isItemSelectBorderEn: 0,
          itemName: Array.from({ length: 20 }, () => ' '),
        }),
        isEventCapture: 1,
        xPosition: 0,
        yPosition: 0,
        width: 1,
        height: 1,
      })]
    }

    if (!state.startupRendered) {
      await bridge.createStartUpPageContainer(new CreateStartUpPageContainer(config))
      state.startupRendered = true
    } else {
      await bridge.rebuildPageContainer(new RebuildPageContainer(config))
    }
    currentLayout = 'reading'

    await sendTiles()
  }

  async function sendTiles(): Promise<void> {
    const bridge = state.bridge
    const canvas = state.prayerCanvas
    const layout = state.tileLayout
    if (!bridge || !canvas || !layout) return
    if (state.sending) return

    state.sending = true
    try {
      for (let i = 0; i < layout.totalTiles; i++) {
        const png = await canvas.getTilePng(state.scrollY, i)
        await bridge.updateImageRawData(new ImageRawDataUpdate({
          containerID: i + 1,
          containerName: `lit-img-${i}`,
          imageData: png,
        }))
      }
    } catch (err) {
      log(`Image send error: ${err}`)
    } finally {
      state.sending = false
    }
  }

  // ── Auto-scroll timer ──

  function startScrollTimer(): void {
    stopScrollTimer()
    if (state.view !== 'reading') return

    const settings = loadSettings()
    if (settings.scrollMode !== 'auto') return
    const layout = state.tileLayout
    if (!layout) return

    const pxPerSecond = layout.viewportHeight / settings.autoScrollSeconds
    const INTERVAL_MS = 50
    const pxPerTick = Math.max(1, Math.round(pxPerSecond * (INTERVAL_MS / 1000)))

    state.scrollTimerId = window.setInterval(() => {
      if (state.scrollPaused || state.view !== 'reading') return

      const max = maxScrollY()
      if (state.scrollY < max) {
        state.scrollY = Math.min(state.scrollY + pxPerTick, max)
        void sendTiles()
        onReadingChanged?.('', progressStr())
      } else {
        log('Reached end')
        state.scrollPaused = true
      }
    }, INTERVAL_MS)
  }

  function stopScrollTimer(): void {
    if (state.scrollTimerId !== null) {
      window.clearInterval(state.scrollTimerId)
      state.scrollTimerId = null
    }
    state.scrollPaused = false
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
        onReadingEvent(eventType)
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
        const content = await fetchHour(hour.slug, state.date)

        stopSpinner()

        const settings = loadSettings()
        const layout = computeTileLayout(settings.displayColumns)
        state.tileLayout = layout
        state.prayerCanvas = new PrayerCanvas(content.sections, {
          fontSize: settings.fontSize,
          fontWeight: settings.fontWeight,
          letterSpacing: settings.letterSpacing,
        }, layout)
        state.scrollY = 0
        state.scrollPaused = false
        state.view = 'reading'
        publishPhase('reading')
        log(`${hour.name}: ${layout.canvasWidth}×${state.prayerCanvas.totalHeight}px, ${layout.cols}col`)

        await setupReadingLayout()
        startScrollTimer()
      } catch (err) {
        stopSpinner()
        log(`Error: ${err}`)
        state.view = 'hours'
        publishPhase('error')
        await renderHourListPage()
      }
    }
  }

  function onReadingEvent(eventType: number | undefined): void {
    if (eventType === OsEventTypeList.DOUBLE_CLICK_EVENT) {
      stopScrollTimer()
      state.prayerCanvas = null
      state.tileLayout = null
      state.scrollY = 0
      state.view = 'hours'
      onReadingChanged?.('', '')
      publishPhase(state.mode === 'mock' ? 'mock' : 'connected')
      log('Back to hour list')
      void renderHourListPage()
      return
    }

    if (eventType === OsEventTypeList.CLICK_EVENT) {
      const settings = loadSettings()
      if (settings.scrollMode === 'auto') {
        state.scrollPaused = !state.scrollPaused
        log(state.scrollPaused ? 'Paused' : 'Resumed')
      }
      return
    }

    const vpHeight = state.tileLayout?.viewportHeight ?? 200
    const SCROLL_STEP = vpHeight / 4

    if (eventType === OsEventTypeList.SCROLL_BOTTOM_EVENT) {
      const max = maxScrollY()
      if (state.scrollY < max) {
        state.scrollY = Math.min(state.scrollY + SCROLL_STEP, max)
        void sendTiles()
        onReadingChanged?.('', progressStr())
      }
    } else if (eventType === OsEventTypeList.SCROLL_TOP_EVENT) {
      if (state.scrollY > 0) {
        state.scrollY = Math.max(state.scrollY - SCROLL_STEP, 0)
        void sendTiles()
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
      const content = await fetchHour(slug, state.date)

      stopSpinner()

      const settings = loadSettings()
      const layout = computeTileLayout(settings.displayColumns)
      state.tileLayout = layout
      state.prayerCanvas = new PrayerCanvas(content.sections, {
        fontSize: settings.fontSize,
        fontWeight: settings.fontWeight,
        letterSpacing: settings.letterSpacing,
      }, layout)
      state.scrollY = 0
      state.scrollPaused = false
      state.view = 'reading'
      publishPhase('reading')
      log(`${content.name}: ${layout.canvasWidth}×${state.prayerCanvas.totalHeight}px, ${layout.cols}col`)

      if (state.bridge) {
        await setupReadingLayout()
        startScrollTimer()
      }
    } catch (err) {
      stopSpinner()
      log(`Error: ${err}`)
      publishPhase('error')
    }
  }

  function scrollDown(): void {
    const vpHeight = state.tileLayout?.viewportHeight ?? 200
    const SCROLL_STEP = vpHeight / 4
    const max = maxScrollY()
    if (state.scrollY < max) {
      state.scrollY = Math.min(state.scrollY + SCROLL_STEP, max)
      if (state.bridge) void sendTiles()
      onReadingChanged?.('', progressStr())
    }
  }

  function scrollUp(): void {
    const vpHeight = state.tileLayout?.viewportHeight ?? 200
    const SCROLL_STEP = vpHeight / 4
    if (state.scrollY > 0) {
      state.scrollY = Math.max(state.scrollY - SCROLL_STEP, 0)
      if (state.bridge) void sendTiles()
      onReadingChanged?.('', progressStr())
    }
  }

  function stopReading(): void {
    stopScrollTimer()
    stopSpinner()
    state.prayerCanvas = null
    state.tileLayout = null
    state.scrollY = 0
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
    scrollDown,
    scrollUp,
    stopReading,
    getState: () => ({ ...state }),
  }
}
