/**
 * Head-tilt page turning for the G2 — hold-to-repeat.
 *
 * Tilt your head RIGHT past the dead-zone angle → advance a page, and keep
 * advancing ONE PAGE PER SECOND while held. Tilt LEFT → go back, one page/sec.
 * Within the dead zone nothing happens (so casual movement doesn't flip pages).
 * The dead-zone angle is user-configurable (settings.headTiltDeg, default 10°).
 *
 * The tilt angle is derived from the accelerometer gravity vector
 * (atan2 of the responding axis vs vertical) — calibrated to real G2 data
 * (units are g, gravity ~1.0 on Z at rest). Axis/sign/timing are tunable at
 * runtime via globalThis.__HG = { deadzone, repeatMs, invert, smooth, fb }.
 */

import type { EvenAppBridge } from '@evenrealities/even_hub_sdk'
import { loadSettings } from './settings'

export type GestureAction = 'scroll_up' | 'scroll_down' | 'tap' | 'double_tap'
export type GestureCallback = (action: GestureAction) => void

const REPORT_FREQ_MS = 100 // ImuReportPace.P100 — fastest reporting
const DEFAULTS = {
  repeatMs: 1000,         // hold a tilt → repeat one page this often
  invert: false,
  smooth: 0.05,           // baseline drift toward true level when near neutral
  fb: 'ay' as 'ax' | 'ay',
  rearmMs: 350,           // must dwell near level this long before an opposite tilt can fire
  rearmFrac: 0.5,         // "near level" = within deadzone * this fraction
}

let active = false
let callback: GestureCallback | null = null
let logCb: ((msg: string) => void) | null = null
let samples = 0
let restPitch: number | null = null
let lastEmit = 0
let heldDir = 0       // direction currently held past the dead zone: +1 next, -1 prev, 0 neutral
let armed = true      // may a FRESH/opposite tilt fire? re-armed only after dwelling near level
let neutralSince = 0  // timestamp the head first re-entered the near-level zone (0 = not in it)

function tune() { return { ...DEFAULTS, ...((globalThis as any).__HG || {}) } }
function deadzoneDeg(): number {
  const o = (globalThis as any).__HG || {}
  if (typeof o.deadzone === 'number') return o.deadzone
  const s = loadSettings().headTiltDeg
  return typeof s === 'number' && s > 0 ? s : 10
}

// Pull accel {x,y,z} (g) out of the SDK's IMU event (event.sysEvent.imuData).
function extract(event: any): { ax: number; ay: number; az: number } | null {
  const d = event?.sysEvent?.imuData ?? event?.imuData ?? event?.imuEvent ?? event?.imu
    ?? event?.sensorEvent ?? event?.motionEvent ?? event?.accelerometer ?? null
  if (!d) return null
  const num = (...keys: string[]) => { for (const k of keys) if (typeof d[k] === 'number') return d[k]; return undefined }
  const ax = num('x', 'ax', 'accX'); const ay = num('y', 'ay', 'accY'); const az = num('z', 'az', 'accZ')
  if (ax === undefined && ay === undefined && az === undefined) return null
  return { ax: ax ?? 0, ay: ay ?? 0, az: az ?? 0 }
}

// Forward/back tilt angle (deg) from the gravity vector.
function pitchDeg(d: { ax: number; ay: number; az: number }, fb: 'ax' | 'ay'): number {
  return Math.atan2(d[fb], d.az) * 180 / Math.PI
}

export function handleImuEvent(event: any): boolean {
  const d = extract(event)
  if (!d) return false
  samples++
  const t = tune()
  const pitch = pitchDeg(d, t.fb)

  if (restPitch === null) {
    restPitch = pitch
    logCb?.(`IMU rest pitch=${pitch.toFixed(1)}°`)
    return true
  }
  const dev = pitch - restPitch
  if (samples <= 10) logCb?.(`IMU ax=${d.ax.toFixed(2)} ay=${d.ay.toFixed(2)} az=${d.az.toFixed(2)} Δ=${dev.toFixed(1)}°`)

  const dz = deadzoneDeg()
  const now = Date.now()

  // Near level: nothing fires. Let the baseline drift toward true level, and
  // dwell here long enough to re-arm the NEXT deliberate tilt. A quick
  // pass-through — returning the head to level, or overshooting past it — does
  // NOT re-arm, so the return motion can no longer flip the page backwards.
  if (Math.abs(dev) < dz) {
    restPitch += (pitch - restPitch) * t.smooth
    if (Math.abs(dev) < dz * t.rearmFrac) {
      if (neutralSince === 0) neutralSince = now
      if (!armed && now - neutralSince >= t.rearmMs) { armed = true; heldDir = 0 }
    }
    return true
  }

  // Beyond the dead zone.
  neutralSince = 0
  const dir = ((dev > 0) !== t.invert) ? 1 : -1 // +1 → next (scroll_down), -1 → prev (scroll_up)

  if (dir === heldDir) {
    // Same direction still held → repeat one page per repeatMs.
    if (now - lastEmit >= t.repeatMs) {
      lastEmit = now
      logCb?.(`Head tilt ${dir > 0 ? 'right → next' : 'left → prev'} (held, ${dev.toFixed(0)}°)`)
      callback?.(dir > 0 ? 'scroll_down' : 'scroll_up')
    }
    return true
  }

  // A fresh / opposite-direction tilt. Only fire if we've re-armed by dwelling
  // near level — this is what suppresses the return-to-level + overshoot that
  // was reading as a backward page turn.
  if (!armed) return true
  armed = false
  heldDir = dir
  lastEmit = now
  logCb?.(`Head tilt ${dir > 0 ? 'right → next' : 'left → prev'} (${dev.toFixed(0)}°)`)
  callback?.(dir > 0 ? 'scroll_down' : 'scroll_up')
  return true
}

async function setImu(bridge: EvenAppBridge, on: boolean): Promise<boolean> {
  const b = bridge as any
  if (typeof b.imuControl === 'function') {
    try {
      const r = await b.imuControl(on, REPORT_FREQ_MS)
      logCb?.(`imuControl(${on}, ${REPORT_FREQ_MS}) → ${JSON.stringify(r)}`)
      return r !== false // host returns a boolean ack; honor a rejection
    } catch (e) { logCb?.(`imuControl threw: ${e} — trying callEvenApp`) }
  } else {
    logCb?.('bridge.imuControl missing (SDK?) — trying callEvenApp')
  }
  try {
    const r = await b.callEvenApp('imuControl', { isOpen: on, reportFrq: REPORT_FREQ_MS })
    logCb?.(`callEvenApp imuControl → ${JSON.stringify(r)}`)
    return true
  } catch (e) { logCb?.(`callEvenApp imuControl failed: ${e}`); return false }
}

export async function startHeadGestures(bridge: EvenAppBridge, cb: GestureCallback, log?: (msg: string) => void): Promise<boolean> {
  callback = cb
  logCb = log ?? null
  samples = 0
  restPitch = null
  heldDir = 0
  armed = true
  neutralSince = 0
  lastEmit = 0
  const ok = await setImu(bridge, true)
  active = ok
  logCb?.(ok ? `Head tilt on — right=next, left=prev (dead zone ${deadzoneDeg()}°)` : 'Head gestures: IMU unavailable')
  return ok
}

export async function stopHeadGestures(bridge: EvenAppBridge): Promise<void> {
  if (!active) return
  await setImu(bridge, false)
  active = false
  callback = null
}

export function isHeadGesturesActive(): boolean {
  return active
}
