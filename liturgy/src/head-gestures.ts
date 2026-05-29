/**
 * Head-gesture page turning for the G2, using the IMU.
 *
 * Gesture (per Will): a quick head TURN and return —
 *   - turn RIGHT and back  → next page  (emits 'scroll_down')
 *   - turn LEFT and back    → previous page (emits 'scroll_up')
 *
 * A head turn is yaw (rotation about the vertical/gravity axis). We detect it
 * preferably from the GYROSCOPE (yaw-rate spike on the gravity-aligned axis);
 * if only accelerometer is reported, we fall back to the lateral acceleration
 * TRANSIENT a quick turn produces. Direction = sign of the spike; the long
 * cooldown absorbs the "and back" return so one turn = one page.
 *
 * IMPORTANT: `imuControl` and the IMU report shape are not in the installed SDK
 * types (only in the live docs), and the axis orientation/units are
 * undocumented. So detection is adaptive + heavily logged, and thresholds are
 * tunable at runtime via `globalThis.__HG = { accel, gyro, cooldown, invert }`
 * for on-device calibration from the in-app Event Log.
 */

import type { EvenAppBridge } from '@evenrealities/even_hub_sdk'

export type GestureAction = 'scroll_up' | 'scroll_down' | 'tap' | 'double_tap'
export type GestureCallback = (action: GestureAction) => void

const REPORT_FREQ_MS = 100   // ImuReportPace.P100 — fast, to catch a quick turn
// Calibrated to real G2 data: accel is in g, gravity ~1.0 on one axis, a turn
// deflects a horizontal axis ~0.4–0.5 g. Threshold sits between rest-jitter
// (~0.03) and a real turn. `smooth` keeps the baseline at rest, not chasing.
const DEFAULTS = { accel: 0.3, gyro: 1.2, cooldown: 700, invert: false, smooth: 0.06 }

let active = false
let callback: GestureCallback | null = null
let logCb: ((msg: string) => void) | null = null
let lastGesture = 0
let samples = 0

// EMA baselines (so we measure transients, not the resting gravity vector)
const base = { ax: 0, ay: 0, az: 0 }
let baseReady = false

function tune() {
  const o = (globalThis as any).__HG || {}
  return { ...DEFAULTS, ...o }
}

// Pull accel (+ optional gyro) out of whatever shape the host sends.
function extract(event: any): { ax: number; ay: number; az: number; gx?: number; gy?: number; gz?: number } | null {
  // SDK 0.0.10 delivers IMU at event.sysEvent.imuData = { x, y, z } (filter by
  // sysEvent.eventType === IMU_DATA_REPORT; imuData only exists on those).
  // Other shapes kept as fallbacks for safety.
  const d = event?.sysEvent?.imuData ?? event?.imuData ?? event?.imuEvent ?? event?.imu
    ?? event?.sensorEvent ?? event?.motionEvent ?? event?.motion ?? event?.sensor ?? event?.accelerometer ?? null
  if (!d) return null
  const num = (...keys: string[]) => { for (const k of keys) if (typeof d[k] === 'number') return d[k]; return undefined }
  const ax = num('x', 'ax', 'accX', 'accelX', 'acc_x')
  const ay = num('y', 'ay', 'accY', 'accelY', 'acc_y')
  const az = num('z', 'az', 'accZ', 'accelZ', 'acc_z')
  if (ax === undefined && ay === undefined && az === undefined) return null
  return {
    ax: ax ?? 0, ay: ay ?? 0, az: az ?? 0,
    gx: num('gx', 'gyroX', 'gyro_x', 'rotX'),
    gy: num('gy', 'gyroY', 'gyro_y', 'rotY'),
    gz: num('gz', 'gyroZ', 'gyro_z', 'rotZ'),
  }
}

function fire(action: GestureAction): void {
  lastGesture = Date.now()
  logCb?.(`Head turn → ${action === 'scroll_down' ? 'next' : 'prev'}`)
  callback?.(action)
}

// True if the event was an IMU sample (consumed here), so the controller can
// skip its normal tap/scroll handling for it.
export function handleImuEvent(event: any): boolean {
  const d = extract(event)
  if (!d) return false
  samples++

  const t = tune()
  if (!baseReady || samples <= 3) {
    base.ax = d.ax; base.ay = d.ay; base.az = d.az; baseReady = true
    if (samples <= 12) logCb?.(`IMU ax=${d.ax.toFixed(2)} ay=${d.ay.toFixed(2)} az=${d.az.toFixed(2)}${d.gz !== undefined ? ` gz=${d.gz.toFixed(2)}` : ''}`)
    return true
  }
  base.ax += (d.ax - base.ax) * t.smooth
  base.ay += (d.ay - base.ay) * t.smooth
  base.az += (d.az - base.az) * t.smooth
  if (samples <= 12) logCb?.(`IMU ax=${d.ax.toFixed(2)} ay=${d.ay.toFixed(2)} az=${d.az.toFixed(2)}${d.gz !== undefined ? ` gz=${d.gz.toFixed(2)}` : ''}`)

  if (Date.now() - lastGesture < t.cooldown) return true

  // Which accel axis holds gravity at rest (largest |baseline|) → that's the
  // vertical axis; yaw rotates about it.
  const absB = { ax: Math.abs(base.ax), ay: Math.abs(base.ay), az: Math.abs(base.az) }
  const gravAxis = absB.ax >= absB.ay && absB.ax >= absB.az ? 'ax' : absB.ay >= absB.az ? 'ay' : 'az'

  let signal = 0
  if (d.gx !== undefined || d.gy !== undefined || d.gz !== undefined) {
    // Gyro present: yaw-rate is the gyro component on the gravity axis.
    const g = { ax: d.gx ?? 0, ay: d.gy ?? 0, az: d.gz ?? 0 } as Record<string, number>
    const yaw = g[gravAxis]
    if (Math.abs(yaw) > t.gyro) signal = yaw
  } else {
    // Accel-only: use the larger of the two HORIZONTAL axes' transient.
    const horiz = (['ax', 'ay', 'az'] as const).filter((k) => k !== gravAxis)
    const devs = horiz.map((k) => d[k] - (base as any)[k])
    const dev = Math.abs(devs[0]) >= Math.abs(devs[1]) ? devs[0] : devs[1]
    if (Math.abs(dev) > t.accel) signal = dev
  }

  if (signal !== 0) {
    const right = (signal > 0) !== t.invert
    fire(right ? 'scroll_down' : 'scroll_up')
  }
  return true
}

async function setImu(bridge: EvenAppBridge, on: boolean): Promise<boolean> {
  const b = bridge as any
  // Documented API first, then the older callEvenApp escape hatch.
  try { if (typeof b.imuControl === 'function') { await b.imuControl(on, REPORT_FREQ_MS); return true } } catch { /* fall through */ }
  try { await b.callEvenApp('imuControl', { isOpen: on, reportFrq: REPORT_FREQ_MS }); return true } catch { return false }
}

export async function startHeadGestures(bridge: EvenAppBridge, cb: GestureCallback, log?: (msg: string) => void): Promise<boolean> {
  callback = cb
  logCb = log ?? null
  samples = 0
  baseReady = false
  lastGesture = 0
  const ok = await setImu(bridge, true)
  active = ok
  logCb?.(ok ? 'Head gestures: IMU on (turn right→next, left→prev)' : 'Head gestures: IMU unavailable')
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
