import {
  CreateStartUpPageContainer,
  EventSourceType,
  ListContainerProperty,
  ListItemContainerProperty,
  OsEventTypeList,
  RebuildPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
  waitForEvenAppBridge,
  type EvenAppBridge,
  type LaunchSource,
} from '@evenrealities/even_hub_sdk'
import { withTimeout } from './shared/async'
import { getRawEventType, normalizeEventType } from './shared/even-events'
import { fetchHours, fetchHour } from './api-client'
import { loadSettings, saveSettings, getBreviaryId } from './settings'
import { getBreviary, localeFor } from './breviaries'
import { startHeadGestures, stopHeadGestures, handleImuEvent, isHeadGesturesActive, recenterHeadGestures } from './head-gestures'
import { toneLevel, toneScaffold } from './tone'
import { paginateSections, type PageLine } from './paginate'
import { menuFor, menuActionFrom, MenuAction, type MenuActionId } from './glasses-menu'
import { getCoords, solarDay, suggestHourIndex, clockLabel, type Coords, type SolarDay } from './geo'
import type { HourInfo, LiturgyPhase, PrayerSection, LiturgicalDay, ScrollMode } from './types'

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
  pages: string[]           // plain-text mirror of pageLines, for the companion panel
  pageLines: PageLine[][]   // what the glasses actually render, one entry per line slot
  sectionLabels: string[]   // section label for each page (parallel to pages)
  pageIndex: number
  autoPaused: boolean       // auto-advance paused by a manual interaction
  day?: LiturgicalDay       // liturgical day from the breviary's own calendar
  coords: Coords | null     // phone location, when granted
  solar: SolarDay | null    // today's sunrise / solar noon / sunset here
  suggestedIndex: number    // index into visibleHours() of the office due now
  launchSource: LaunchSource | null
  autoOpened: boolean       // guard: only follow a glasses-menu launch once
}

const DISPLAY_WIDTH = 576

// The firmware font is a fixed 27px line box (see @evenrealities/pretext), and a
// page may hold at most 8 non-image containers. Seven line containers plus the
// footer spends that budget exactly — and buying per-line containers is what
// makes per-line brightness possible, since `textColor` applies to a whole
// container rather than to runs of text inside one.
const LINE_HEIGHT = 27
const LINE_SLOTS = 7
const TEXT_X = 6
const TEXT_W = DISPLAY_WIDTH - 2 * TEXT_X
const FOOTER_Y = 252
const FOOTER_ID = 8
const FOOTER_NAME = 'lit-footer'

const LINES_PER_PAGE = LINE_SLOTS
const AUTO_MIN_DWELL = 3 // seconds — floor so 1-line pages don't linger
const NAV_DEBOUNCE_MS = 250 // ignore duplicate reading-nav gestures within this window

function todayDateStr(): string {
  const d = new Date()
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

/**
 * Wrap to a pixel width using the real firmware metrics.
 *
 * The G2 font is proportional, so any single character budget is wrong in both
 * directions: 62 lowercase characters fit in the 564px line, but only 35
 * capitals do. Counting characters therefore either wasted a quarter of every
 * prose line or silently overflowed an all-caps heading into a clipped second
 * line. @evenrealities/pretext measures the same advance widths the glasses use.
 */
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
    pageLines: [],
    sectionLabels: [],
    pageIndex: 0,
    autoPaused: false,
    coords: null,
    solar: null,
    suggestedIndex: 0,
    launchSource: null,
    autoOpened: false,
  }

  let currentLayout: 'hours' | 'reading' | 'loading' | null = null
  let spinnerIntervalId: number | null = null
  let autoTimerId: number | null = null
  let lastReadingNav = 0 // timestamp of the last accepted reading-nav gesture (debounce)
  let imuSeen = 0 // count of raw IMU events seen from the host (diagnostics)
  // What the glasses are currently showing, per line slot — so a page turn can
  // push only the slots that actually changed.
  let renderedLines: PageLine[] = []
  let renderedBar = ''

  function publishPhase(phase: LiturgyPhase): void {
    setPhase?.(phase)
  }

  function visibleHours(): HourInfo[] {
    const settings = loadSettings()
    return state.hours.filter(h => {
      // Match hidden hours by name (e.g. "midday-prayer" matches "Midday Prayer")
      const nameKey = (h.name || '').toLowerCase().replace(/\s+/g, '-')
        .replace(/yesterday's-/, '') // "Yesterday's Night Prayer" -> "night-prayer"
      return !settings.hiddenHours.includes(nameKey)
    })
  }

  function progressStr(): string {
    if (state.pages.length <= 1) return '100%'
    return `${state.pageIndex + 1}/${state.pages.length}`
  }

  function progressBar(): string {
    // Box-drawing glyphs are 20px wide, so 28 is the most that fits the 564px
    // line — the old 30 measured 600px and wrapped into a clipped second line.
    const barLen = 26
    const progress = state.pages.length > 1
      ? (state.pageIndex + 1) / state.pages.length
      : 1
    const filled = Math.round(barLen * progress)
    return '\u2501'.repeat(filled) + '\u2500'.repeat(barLen - filled)
  }

  // ── Head gesture control ──

  async function startHeadGestureMode(): Promise<void> {
    const bridge = state.bridge
    if (!bridge) { log('(head gestures: bridge not ready yet — will retry on resume/toggle)'); return }
    if (isHeadGesturesActive()) return // already running — don't re-init / re-enable IMU
    const settings = loadSettings()
    log(`Head-gesture start: scrollMode=${settings.scrollMode}, deadzone=${settings.headTiltDeg}°`)
    if (settings.scrollMode !== 'head-gesture') {
      log(`(scroll mode is "${settings.scrollMode}", not head gestures — IMU stays off)`)
      return
    }

    const started = await startHeadGestures(bridge, (action) => {
      log(`Gesture: ${action}`)
      switch (action) {
        case 'scroll_down':
          if (state.view === 'reading') void onReadingEvent(OsEventTypeList.SCROLL_BOTTOM_EVENT)
          break
        case 'scroll_up':
          if (state.view === 'reading') void onReadingEvent(OsEventTypeList.SCROLL_TOP_EVENT)
          break
        case 'tap':
          if (state.view === 'reading') void onReadingEvent(OsEventTypeList.CLICK_EVENT)
          else if (state.view === 'hours') void onHourListEvent(OsEventTypeList.CLICK_EVENT, state.selectedHourIndex)
          break
        case 'double_tap':
          if (state.view === 'reading') void onReadingEvent(OsEventTypeList.DOUBLE_CLICK_EVENT)
          else if (state.view === 'hours') void onHourListEvent(OsEventTypeList.DOUBLE_CLICK_EVENT, state.selectedHourIndex)
          break
      }
    }, log)

    if (started) {
      log('Head gesture mode active')
    } else {
      log('Head gestures unavailable — IMU not supported in this SDK version')
    }
  }

  async function stopHeadGestureMode(): Promise<void> {
    if (state.bridge) await stopHeadGestures(state.bridge)
  }

  // Reconcile live hardware (IMU / auto-advance timer) with the CURRENT scroll
  // mode while an hour is open. Idempotent — safe to call after a settings
  // change, on foreground-resume, or once the bridge attaches. This is what
  // makes a saved "head gestures" default take effect without re-opening the
  // hour, and makes flipping the Scroll-mode setting apply immediately.
  async function applyScrollMode(): Promise<void> {
    if (state.view !== 'reading') return
    const mode = loadSettings().scrollMode
    if (mode === 'head-gesture') await startHeadGestureMode()
    else if (isHeadGesturesActive()) await stopHeadGestureMode()
    if (mode === 'auto') startAutoAdvance(); else pauseAuto()
  }

  // ── Reading layout ──
  //
  // One container per line, stacked on the firmware's fixed 27px line box, plus
  // the footer: seven plus one spends the page's 8-container budget exactly.
  // Paying for per-line containers is what buys per-line brightness, because
  // `textColor` applies to a whole container and not to runs of text inside one.
  //
  // The geometry never changes between pages, so a page turn is still a set of
  // textContainerUpgrade calls (flicker-free) rather than a rebuild.

  function lineSlotId(i: number): number { return i + 1 }
  function lineSlotName(i: number): string { return `lit-line-${i}` }

  // A blank slot is sent as a single space rather than an empty string: an empty
  // payload is not reliably treated as "clear this container", and a stale line
  // left behind on a page turn is much worse than a space.
  const BLANK = ' '

  function slotLines(): PageLine[] {
    const page = state.pageLines[state.pageIndex] ?? []
    const tonesOn = loadSettings().toneBrightness
    const out: PageLine[] = []
    for (let i = 0; i < LINE_SLOTS; i++) {
      const line = page[i]
      if (!line || !line.text.trim()) { out.push({ text: BLANK, tone: 'body' }); continue }
      // Tones off → put the old ASCII scaffolding back and render flat, so an
      // Even App that predates textColor still shows a hierarchy.
      out.push(tonesOn ? line : { text: toneScaffold(line.text, line.tone), tone: 'body' })
    }
    return out
  }

  function readingContainers(lines: PageLine[], bar: string): TextContainerProperty[] {
    const containers = lines.map((line, i) => new TextContainerProperty({
      containerID: lineSlotId(i),
      containerName: lineSlotName(i),
      content: line.text,
      xPosition: TEXT_X,
      yPosition: i * LINE_HEIGHT,
      width: TEXT_W,
      height: LINE_HEIGHT,
      borderWidth: 0,
      paddingLength: 0,
      textColor: toneLevel(line.tone),
      isEventCapture: 0,
    }))

    containers.push(new TextContainerProperty({
      containerID: FOOTER_ID,
      containerName: FOOTER_NAME,
      content: bar,
      xPosition: TEXT_X,
      yPosition: FOOTER_Y,
      width: TEXT_W,
      height: LINE_HEIGHT,
      borderWidth: 0,
      paddingLength: 0,
      textColor: toneLevel('faint'),
      // Exactly one container must capture events, and the footer is the only
      // one that is never blank — so it is the safe place to put it.
      isEventCapture: 1,
    }))

    return containers
  }

  async function setupReadingLayout(): Promise<void> {
    const bridge = state.bridge
    if (!bridge) return

    stopSpinner()

    const lines = slotLines()
    const bar = progressBar()
    const containers = readingContainers(lines, bar)

    const config = {
      containerTotalNum: containers.length,
      textObject: containers,
      menuObject: menuFor('reading', localeFor(getBreviaryId())),
    }

    try {
      if (!state.startupRendered) {
        await bridge.createStartUpPageContainer(new CreateStartUpPageContainer(config))
        state.startupRendered = true
      } else {
        await bridge.rebuildPageContainer(new RebuildPageContainer(config))
      }
      currentLayout = 'reading'
      renderedLines = lines
      renderedBar = bar
    } catch (err) {
      log(`setupReadingLayout error: ${err}`)
    }
  }

  async function updatePageText(): Promise<void> {
    const bridge = state.bridge
    if (!bridge || currentLayout !== 'reading') return

    const lines = slotLines()
    const bar = progressBar()
    try {
      // Push only the slots whose text or tone moved. Most page turns change
      // five or six of the seven, and trailing blanks usually stay blank, so the
      // BLE cost stays close to the old single-container update.
      for (let i = 0; i < LINE_SLOTS; i++) {
        const next = lines[i]!
        const prev = renderedLines[i]
        if (prev && prev.text === next.text && prev.tone === next.tone) continue
        await bridge.textContainerUpgrade(new TextContainerUpgrade({
          containerID: lineSlotId(i),
          containerName: lineSlotName(i),
          contentOffset: 0,
          contentLength: next.text.length,
          content: next.text,
          textColor: toneLevel(next.tone),
        }))
        renderedLines[i] = next
      }
      if (bar !== renderedBar) {
        await bridge.textContainerUpgrade(new TextContainerUpgrade({
          containerID: FOOTER_ID,
          containerName: FOOTER_NAME,
          contentOffset: 0,
          contentLength: bar.length,
          content: bar,
          textColor: toneLevel('faint'),
        }))
        renderedBar = bar
      }
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
      // Carry the menu through loading too — a fetch that hangs should still be
      // escapable with a long press.
      menuObject: menuFor('hours', localeFor(getBreviaryId())),
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
    if (!bridge) { log('[glasses] render skipped (no bridge)'); return }

    const hours = visibleHours()
    if (hours.length === 0) {
      log('[glasses] no visible hours')
      return
    }

    log(`[glasses] rendering ${hours.length} hours (startup=${state.startupRendered})`)
    stopSpinner()

    const titleText = new TextContainerProperty({
      containerID: 1,
      containerName: 'lit-title',
      content: 'Liturgy of the Hours',
      xPosition: 8,
      yPosition: 0,
      width: 560,
      height: LINE_HEIGHT,
      // Chrome, not content: let the hour names read first.
      textColor: toneLevel('heading'),
      isEventCapture: 0,
    })

    // The firmware owns list highlighting and offers no way to preselect an
    // item, so the office that is due is marked in its own label instead.
    const marked = hours.map((h, i) => (i === state.suggestedIndex ? `\u25b8 ${h.name}` : h.name))

    const hourList = new ListContainerProperty({
      containerID: 2,
      containerName: 'lit-hour-list',
      itemContainer: new ListItemContainerProperty({
        itemCount: hours.length,
        itemWidth: 556,
        isItemSelectBorderEn: 1,
        itemName: marked,
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
      menuObject: menuFor('hours', localeFor(getBreviaryId())),
    }

    try {
      if (!state.startupRendered) {
        const r = await bridge.createStartUpPageContainer(new CreateStartUpPageContainer(config))
        log(`[glasses] createStartUpPageContainer → ${r}`)
        state.startupRendered = true
      } else {
        const r = await bridge.rebuildPageContainer(new RebuildPageContainer(config))
        log(`[glasses] rebuildPageContainer → ${r}`)
      }
      currentLayout = 'hours'
    } catch (err) {
      log(`[glasses] render list FAILED: ${err}`)
      throw err
    }
  }

  // ── Event handling ──

  function registerEventLoop(bridge: EvenAppBridge): void {
    if (state.eventLoopRegistered) return

    bridge.onEvenHubEvent(async (event) => {
      // Diagnostic: does the host stream IMU at all? Count raw IMU reports
      // (eventType 8 or any imuData payload) BEFORE the head-gesture consume,
      // so the log proves streaming even if extract()/active-state is wrong.
      const looksImu = event?.sysEvent?.eventType === OsEventTypeList.IMU_DATA_REPORT || !!event?.sysEvent?.imuData
      if (looksImu) {
        imuSeen++
        if (imuSeen === 1) log('✓ first raw IMU event from host')
        else if (imuSeen % 50 === 0) log(`IMU stream alive (${imuSeen} samples)`)
      }

      // IMU samples flow through this same handler — consume them for head
      // gestures before the normal tap/scroll/list handling.
      if (isHeadGesturesActive() && handleImuEvent(event)) return

      // A long-press menu pick arrives on this same stream. Handle it ahead of
      // everything else, including the loading guard below, so a hung fetch can
      // still be escaped.
      const menuAction = menuActionFrom(event)
      if (menuAction !== null) {
        log(`Menu: ${menuAction}`)
        await onMenuAction(menuAction)
        return
      }

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

      // ── Input diagnostics: log every gesture (ring vs touchpad) so a
      // double-advance / duplicate-event bug shows itself in the Event Log. ──
      const src: number | undefined = event?.sysEvent?.eventSource
      const srcName = src === EventSourceType.TOUCH_EVENT_FROM_RING ? 'ring'
        : src === EventSourceType.TOUCH_EVENT_FROM_GLASSES_R ? 'templeR'
        : src === EventSourceType.TOUCH_EVENT_FROM_GLASSES_L ? 'templeL'
        : (src == null ? '—' : `src${src}`)
      const field = event.listEvent ? 'list' : event.textEvent ? 'text' : event.sysEvent ? 'sys' : '?'
      const nm: Record<number, string> = { 0: 'CLICK', 1: 'SCROLL_TOP', 2: 'SCROLL_BOTTOM', 3: 'DOUBLE', 4: 'FG_ENTER', 5: 'FG_EXIT', 6: 'ABN_EXIT', 7: 'SYS_EXIT', 8: 'IMU', 9: 'LONG_PRESS', 10: 'LONG_RELEASE' }
      log(`evt[${field}] src=${srcName} raw=${JSON.stringify(rawEventType)} → ${eventType == null ? '—' : (nm[eventType] ?? eventType)} idx=${incomingIndex} view=${state.view}`)

      if (state.view === 'loading') return

      // App resumed from background → re-apply scroll mode so head-gesture IMU
      // (which the host stops while backgrounded) comes back on automatically.
      if (eventType === OsEventTypeList.FOREGROUND_ENTER_EVENT) { void applyScrollMode(); return }

      if (state.view === 'hours') {
        await onHourListEvent(eventType, incomingIndex)
      } else if (state.view === 'reading') {
        await onReadingEvent(eventType, src)
      }
    })

    state.eventLoopRegistered = true
  }

  async function onHourListEvent(eventType: number | undefined, incomingIndex: number): Promise<void> {
    // Double-tap on the top-level hour list exits the app (fires the system
    // exit-confirmation dialog). This is the user's way out of the plugin.
    if (eventType === OsEventTypeList.DOUBLE_CLICK_EVENT) {
      log('Exit requested')
      if (state.bridge) {
        try { await state.bridge.shutDownPageContainer(1) } catch (err) { log(`shutDown failed: ${err}`) }
      }
      return
    }

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
      await openHourAtIndex(idx)
    }
  }

  /** Load and open one office from the visible-hours list, by index. */
  async function openHourAtIndex(idx: number): Promise<void> {
    const hours = visibleHours()
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

      if (content.day) state.day = content.day
      ;({ pages: state.pages, pageLines: state.pageLines, sectionLabels: state.sectionLabels } = paginateSections(content.sections, TEXT_W, LINES_PER_PAGE))
      state.pageIndex = 0
      state.view = 'reading'
      publishPhase('reading')
      log(`${hour.name}: ${state.pages.length} pages`)

      await setupReadingLayout()
      void startHeadGestureMode()
      startAutoAdvance()
    } catch (err) {
      stopSpinner()
      log(`Error: ${err}`)
      state.view = 'hours'
      publishPhase('error')
      await renderHourListPage()
    }
  }

  /** Leave the office and go back to the list of hours. */
  async function backToHourList(): Promise<void> {
    pauseAuto()
    void stopHeadGestureMode()
    state.pages = []
    state.pageLines = []
    state.pageIndex = 0
    state.view = 'hours'
    onReadingChanged?.('', '')
    publishPhase(state.mode === 'mock' ? 'mock' : 'connected')
    log('Back to hour list')
    await renderHourListPage()
  }

  function cycleScrollMode(): ScrollMode {
    const order: ScrollMode[] = ['manual', 'auto', 'head-gesture']
    const settings = loadSettings()
    const next = order[(order.indexOf(settings.scrollMode) + 1) % order.length]!
    settings.scrollMode = next
    saveSettings(settings)
    return next
  }

  // ── Long-press menu ──
  // Every item is a verb that completes on its own: the overlay is
  // fire-and-forget, so there is nothing to acknowledge and no menu state to
  // keep. This is what got navigation off the touchpad — tap and swipe now mean
  // only "turn the page".
  async function onMenuAction(action: MenuActionId): Promise<void> {
    const hours = visibleHours()

    switch (action) {
      case MenuAction.NextHour:
      case MenuAction.PrevHour: {
        if (hours.length === 0) return
        const delta = action === MenuAction.NextHour ? 1 : -1
        const idx = clamp(state.selectedHourIndex + delta, 0, hours.length - 1)
        if (idx === state.selectedHourIndex) {
          log(delta > 0 ? 'Already at the last hour' : 'Already at the first hour')
          return
        }
        await openHourAtIndex(idx)
        return
      }

      case MenuAction.ScrollMode: {
        const mode = cycleScrollMode()
        log(`Scroll mode: ${mode}`)
        await applyScrollMode()
        return
      }

      case MenuAction.Recentre:
        recenterHeadGestures()
        return

      case MenuAction.HourList:
        if (state.view === 'reading') await backToHourList()
        return

      case MenuAction.OpenCurrentHour:
        await openHourAtIndex(clamp(state.suggestedIndex, 0, Math.max(0, hours.length - 1)))
        return

      case MenuAction.Exit:
        if (state.bridge) {
          try { await state.bridge.shutDownPageContainer(1) } catch (err) { log(`shutDown failed: ${err}`) }
        }
        return
    }
  }

  async function onReadingEvent(eventType: number | undefined, source?: number): Promise<void> {
    pauseAuto() // any on-glasses interaction pauses hands-free advance
    if (eventType === OsEventTypeList.DOUBLE_CLICK_EVENT) {
      await backToHourList()
      return
    }

    // Debounce duplicate nav events: some gestures (notably the R1 ring) deliver
    // the same event twice in quick succession, which advanced 2 pages per
    // gesture. Ignore a second nav within NAV_DEBOUNCE_MS (far faster than any
    // intentional page turn). Confirmed/tuned via the input log.
    if (eventType === OsEventTypeList.CLICK_EVENT
      || eventType === OsEventTypeList.SCROLL_TOP_EVENT
      || eventType === OsEventTypeList.SCROLL_BOTTOM_EVENT) {
      const now = Date.now()
      if (now - lastReadingNav < NAV_DEBOUNCE_MS) { log('(debounced duplicate gesture)'); return }
      lastReadingNav = now
    }

    // Tap turns the page. SDK 0.0.14 tells us WHICH temple was tapped, so the
    // gesture is spatial rather than modal: left goes back, right goes forward.
    // The ring (and any host that does not report a source) keeps the old
    // behaviour of advancing.
    if (eventType === OsEventTypeList.CLICK_EVENT) {
      const back = loadSettings().templeNav
        && source === EventSourceType.TOUCH_EVENT_FROM_GLASSES_L
      if (back) {
        if (state.pageIndex > 0) {
          state.pageIndex--
          await updatePageText()
          onReadingChanged?.('', progressStr())
        } else {
          log('At the first page')
        }
        return
      }
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
      registerLaunchSource(state.bridge)
      publishPhase('connected')
      log('Connected to glasses')

      if (state.hours.length > 0) {
        await renderHourListPage()
        void maybeFollowLaunchSource()
      }
    } catch {
      state.mode = 'mock'
      publishPhase('mock')
      log('Bridge not found, mock mode')
    }
  }

  // ── Launch source ──
  // Opened from the glasses menu you want to pray, not to browse; opened from
  // the phone, the picker is the whole point. The SDK pushes the source exactly
  // once after the page is ready, and it can land either side of loadHours(), so
  // both paths call maybeFollowLaunchSource() and the guard decides.
  function registerLaunchSource(bridge: EvenAppBridge): void {
    if (typeof (bridge as any).onLaunchSource !== 'function') return
    bridge.onLaunchSource((source: LaunchSource) => {
      state.launchSource = source
      log(`Launched from ${source === 'glassesMenu' ? 'the glasses menu' : 'the phone'}`)
      void maybeFollowLaunchSource()
    })
  }

  async function maybeFollowLaunchSource(): Promise<void> {
    if (state.autoOpened) return
    if (state.launchSource !== 'glassesMenu') return
    if (!state.bridge || state.view !== 'hours') return
    const hours = visibleHours()
    if (hours.length === 0) return
    state.autoOpened = true
    const idx = clamp(state.suggestedIndex, 0, hours.length - 1)
    log(`Opening ${hours[idx]?.name ?? '(none)'} — due now`)
    await openHourAtIndex(idx)
  }

  // ── The sun ──
  async function refreshSolar(): Promise<void> {
    state.coords = await getCoords(state.bridge, log)
    state.solar = state.coords ? solarDay(state.coords) : null
    if (state.solar && !state.solar.degenerate) {
      log(`Sun here today: rise ${clockLabel(state.solar.sunrise)} · noon ${clockLabel(state.solar.solarNoon)} · set ${clockLabel(state.solar.sunset)}`)
    } else if (state.solar?.degenerate) {
      log('Polar day or night here — falling back to clock times')
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
      state.day = index.day // liturgical day from this breviary's own calendar

      // Append yesterday's evening & night office for night workers, when the
      // active breviary supports it. Labels follow the breviary's language.
      const breviary = getBreviary(getBreviaryId())
      if (breviary.capabilities.yesterday && yesterdayIndex?.hours) {
        const isEvening = (name: string) => {
          const n = name.toLowerCase()
          return n.includes('evening prayer') || n === 'vespri' || n === 'evensong'
        }
        const isNight = (name: string) => {
          const n = name.toLowerCase()
          return n.includes('night prayer') || n === 'compieta' || n === 'compline'
        }
        const it = breviary.language === 'it'
        const prefix = it ? '' : "Yesterday's "
        const suffix = it ? ' di ieri' : ''
        const ep = yesterdayIndex.hours.find(h => isEvening(h.name))
        const np = yesterdayIndex.hours.find(h => isNight(h.name))
        if (ep) state.hours.push({ ...ep, name: `${prefix}${ep.name}${suffix}` })
        if (np) state.hours.push({ ...np, name: `${prefix}${np.name}${suffix}` })
      }

      // Firmware list highlighting always starts on the first item, so keep our
      // idea of the selection in step with it and carry the suggestion
      // separately — the ▸ marker, "Pray now" and a glasses-menu launch all use
      // suggestedIndex, and nothing silently opens an hour the user did not
      // highlight.
      state.selectedHourIndex = 0

      const settings = loadSettings()
      if (settings.solarHours) await refreshSolar()
      const vis = visibleHours()
      state.suggestedIndex = suggestHourIndex(vis, settings.solarHours ? state.solar : null)
      const due = vis[state.suggestedIndex]
      if (due) log(`Due now: ${due.name}`)

      onHoursLoaded?.(state.hours)
      log(`Loaded ${state.hours.length} hours`)
      publishPhase(state.mode === 'mock' ? 'mock' : state.mode === 'bridge' ? 'connected' : 'idle')

      if (state.bridge && state.hours.length > 0) {
        state.view = 'hours'
        await renderHourListPage()
        void maybeFollowLaunchSource()
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

      if (content.day) state.day = content.day
      ;({ pages: state.pages, pageLines: state.pageLines, sectionLabels: state.sectionLabels } = paginateSections(content.sections, TEXT_W, LINES_PER_PAGE))
      state.pageIndex = 0
      state.view = 'reading'
      publishPhase('reading')
      log(`${content.name}: ${state.pages.length} pages`)

      if (state.bridge) {
        await setupReadingLayout()
        void startHeadGestureMode()
      }
      startAutoAdvance()
    } catch (err) {
      stopSpinner()
      log(`Error: ${err}`)
      publishPhase('error')
    }
  }

  // ── Auto-advance (hands-free pacing) + contemplative silence ──
  function classifySection(label: string): 'psalm' | 'canticle' | 'reading' | 'other' {
    const u = (label || '').toUpperCase()
    if (/\b(SALMO|PSALM)\b/.test(u)) return 'psalm'
    if (/\b(CANTICO|CANTICLE|BENEDICTUS|MAGNIFICAT|NUNC|TE DEUM|ZACCARIA|BEATA VERGINE|SIMEONE)\b/.test(u)) return 'canticle'
    if (/\b(LETTURA|READING|LESSON|PRIMA|SECONDA|EPISTLE|VANGELO|GOSPEL)\b/.test(u)) return 'reading'
    return 'other'
  }
  function clearAutoTimer(): void {
    if (autoTimerId !== null) { window.clearTimeout(autoTimerId); autoTimerId = null }
  }
  // Self-scheduling: waits the page interval, or a longer silence after a
  // psalm/canticle/reading, then advances the glasses one page.
  function scheduleAuto(): void {
    clearAutoTimer()
    if (state.view !== 'reading' || state.autoPaused) return
    const i = state.pageIndex
    if (i >= state.pages.length - 1) return // reached the end
    const s = loadSettings()
    const boundary = state.sectionLabels[i] !== state.sectionLabels[i + 1]
    const finished = classifySection(state.sectionLabels[i] || '')
    const silence = s.silenceEnabled && boundary && finished !== 'other'
    // Scale the normal page dwell by how much text is on the page, so short
    // (often 1-line, formatting-only) pages don't linger the full interval.
    const lineCount = (state.pages[i] || '').split('\n').filter((l) => l.trim().length > 0).length || 1
    const dwell = Math.max(AUTO_MIN_DWELL, s.autoScrollSeconds * Math.min(1, lineCount / LINES_PER_PAGE))
    const delayMs = Math.max(1, silence ? s.silenceSeconds : dwell) * 1000
    autoTimerId = window.setTimeout(async () => {
      autoTimerId = null
      if (state.view !== 'reading' || state.autoPaused) return
      if (state.pageIndex < state.pages.length - 1) {
        state.pageIndex++
        await updatePageText()
        onReadingChanged?.('', progressStr())
      }
      scheduleAuto()
    }, delayMs)
  }
  function startAutoAdvance(): void {
    if (loadSettings().scrollMode !== 'auto') return
    state.autoPaused = false
    scheduleAuto()
  }
  function pauseAuto(): void { state.autoPaused = true; clearAutoTimer() }
  function resumeAuto(): void {
    if (loadSettings().scrollMode !== 'auto' || state.view !== 'reading') return
    state.autoPaused = false
    scheduleAuto()
  }

  // Host-backed persistent storage (survives cold launches; the packaged
  // webview's own localStorage does not). No-ops without a bridge.
  async function getHostStorage(key: string): Promise<string | null> {
    if (!state.bridge) return null
    try { return await state.bridge.getLocalStorage(key) } catch { return null }
  }
  async function setHostStorage(key: string, value: string): Promise<void> {
    if (!state.bridge) return
    try { await state.bridge.setLocalStorage(key, value) } catch { /* ignore */ }
  }

  // Companion-driven page navigation (mirrors the glasses SCROLL events) so the
  // "Now on the glasses" panel's prev/next controls work from the phone.
  async function scrollDown(): Promise<void> {
    pauseAuto() // manual interaction pauses hands-free advance
    if (state.view !== 'reading') return
    if (state.pageIndex < state.pages.length - 1) {
      state.pageIndex++
      await updatePageText()
      onReadingChanged?.('', progressStr())
    }
  }
  async function scrollUp(): Promise<void> {
    pauseAuto()
    if (state.view !== 'reading') return
    if (state.pageIndex > 0) {
      state.pageIndex--
      await updatePageText()
      onReadingChanged?.('', progressStr())
    }
  }

  function stopReading(): void {
    clearAutoTimer()
    void stopHeadGestureMode()
    stopSpinner()
    state.pages = []
    state.pageLines = []
    state.pageIndex = 0
    state.view = 'hours'
    onReadingChanged?.('', '')
    publishPhase(state.mode === 'mock' ? 'mock' : state.mode === 'bridge' ? 'connected' : 'idle')
    if (state.bridge) void renderHourListPage()
    log('Stopped reading')
  }

  // Public render-hour-list hook. Used as a belt-and-suspenders from main.ts
  // after both connect() and loadHours() have resolved, in case the internal
  // race-window checks in either function didn't fire.
  async function renderHourList(): Promise<void> {
    if (!state.bridge) return
    if (state.hours.length === 0) return
    if (currentLayout === 'hours') return
    state.view = 'hours'
    await renderHourListPage()
  }

  return {
    connect,
    loadHours,
    selectHour,
    applyScrollMode,
    scrollUp,
    scrollDown,
    pauseAuto,
    resumeAuto,
    getHostStorage,
    setHostStorage,
    stopReading,
    renderHourList,
    /** Today's solar times here, for the companion panel. Null without a fix. */
    getSunTimes: () => state.solar,
    /** Which office is due right now, as an index into the visible-hours list. */
    getSuggestedHourIndex: () => state.suggestedIndex,
    /** The office due right now, already filtered by the user's hidden hours. */
    getDueHour: (): HourInfo | null => visibleHours()[state.suggestedIndex] ?? null,
    /** Open the office that is due — the companion twin of the "Pray now" item. */
    openSuggestedHour: () => openHourAtIndex(state.suggestedIndex),
    getState: () => ({ ...state }),
  }
}
