/**
 * Head-tilt page turning for the G2 — pitch-based, hold-to-repeat.
 *
 * Tilt/look UP past the dead-zone angle → advance a page, and keep advancing
 * ONE PAGE PER SECOND while held up. Tilt DOWN → go back, one page/second.
 * Within the dead zone nothing happens (so casual glances don't flip pages).
 * The dead-zone angle is user-configurable (settings.headTiltDeg, default 10°).
 *
 * Pitch is derived from the accelerometer gravity vector in the forward/back
 * (Y) vs vertical (Z) plane — calibrated to real G2 data (units are g, gravity
 * ~1.0 on Z at rest). Axis/sign/timing are tunable at runtime via
 *   globalThis.__HG = { deadzone, repeatMs, invert, smooth, fb }
 * for on-device calibration from the in-app Event Log.
 */

import type { EvenAppBridge } from '@evenrealities/even_hub_sdk'
import { loadSettings } from './settings'

export type GestureAction = 'scroll_up' | 'scroll_down' | 'tap' | 'double_tap'
export type GestureCallback = (action: GestureAction) => void

const REPORT_FREQ_MS = 100 // ImuReportPace.P100 — fastest reporting
const DEFAULTS = { repeatMs: 1000, invert: false, smooth: 0.05, fb: 'ay' as 'ax' | 'ay' }

let active = false
let callback: GestureCallback | null = null
let logCb: ((msg: string) => void) | null = null
let samples = 0
let restPitch: number | null = null
let lastEmit = 0
let tiltActive = false

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
  if (Math.abs(dev) < dz) {
    // Inside the dead zone: let the rest baseline drift slowly, clear hold state.
    restPitch += (pitch - restPitch) * t.smooth
    tiltActive = false
    return true
  }
  // Beyond the dead zone: freeze the baseline and page once on entry, then once
  // per repeatMs for as long as the head is held tilted.
  const now = Date.now()
  if (!tiltActive || now - lastEmit >= t.repeatMs) {
    tiltActive = true
    lastEmit = now
    const up = (dev > 0) !== t.invert // up tilt → next page by default
    logCb?.(`Head tilt ${up ? 'up → next' : 'down → prev'} (${dev.toFixed(0)}°)`)
    callback?.(up ? 'scroll_down' : 'scroll_up')
  }
  return true
}

async function setImu(bridge: EvenAppBridge, on: boolean): Promise<boolean> {
  const b = bridge as any
  try { if (typeof b.imuControl === 'function') { await b.imuControl(on, REPORT_FREQ_MS); return true } } catch { /* fall through */ }
  try { await b.callEvenApp('imuControl', { isOpen: on, reportFrq: REPORT_FREQ_MS }); return true } catch { return false }
}

export async function startHeadGestures(bridge: EvenAppBridge, cb: GestureCallback, log?: (msg: string) => void): Promise<boolean> {
  callback = cb
  logCb = log ?? null
  samples = 0
  restPitch = null
  tiltActive = false
  lastEmit = 0
  const ok = await setImu(bridge, true)
  active = ok
  logCb?.(ok ? `Head tilt on — up=next, down=prev (dead zone ${deadzoneDeg()}°)` : 'Head gestures: IMU unavailable')
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
