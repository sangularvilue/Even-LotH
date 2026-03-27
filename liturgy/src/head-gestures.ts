/**
 * Head gesture detection using the G2 IMU.
 *
 * Detects deliberate head jerks and maps them to actions:
 *   - Nod down  → next page (scroll down)
 *   - Nod up    → previous page (scroll up)
 *   - Tilt right → tap / select
 *   - Tilt left  → double-tap / back
 *
 * Uses energy-based jerk detection on the accelerometer axes
 * with a dead zone and cooldown to avoid false triggers.
 */

import type { EvenAppBridge } from '@evenrealities/even_hub_sdk'

export type GestureAction = 'scroll_up' | 'scroll_down' | 'tap' | 'double_tap'
export type GestureCallback = (action: GestureAction) => void

// Tuning parameters
const JERK_THRESHOLD = 1.5    // acceleration spike to count as a jerk
const COOLDOWN_MS = 600       // minimum ms between gestures
const SETTLE_SAMPLES = 3      // ignore first N samples after starting IMU
const REPORT_FREQ_MS = 100    // IMU report interval

let active = false
let callback: GestureCallback | null = null
let logCallback: ((msg: string) => void) | null = null
let lastGestureTime = 0
let sampleCount = 0

// Baseline (running average of recent values)
let baseX = 0
let baseY = 0
let baseZ = 0
const SMOOTH = 0.15  // exponential moving average factor

function processImuData(x: number, y: number, z: number): void {
  sampleCount++

  // Let the baseline settle before detecting
  if (sampleCount <= SETTLE_SAMPLES) {
    baseX = x
    baseY = y
    baseZ = z
    return
  }

  // Update baseline with EMA
  baseX = baseX * (1 - SMOOTH) + x * SMOOTH
  baseY = baseY * (1 - SMOOTH) + y * SMOOTH
  baseZ = baseZ * (1 - SMOOTH) + z * SMOOTH

  // Compute deviation from baseline
  const dx = x - baseX
  const dy = y - baseY
  const dz = z - baseZ

  // Check cooldown
  const now = Date.now()
  if (now - lastGestureTime < COOLDOWN_MS) return

  // Detect jerks on each axis
  // G2 orientation: X = lateral (left/right tilt), Y = vertical (nod), Z = forward/back
  // These may need to be remapped based on actual hardware orientation

  let action: GestureAction | null = null

  if (Math.abs(dy) > JERK_THRESHOLD && Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > Math.abs(dz)) {
    // Strongest jerk is vertical
    action = dy > 0 ? 'scroll_down' : 'scroll_up'
  } else if (Math.abs(dx) > JERK_THRESHOLD && Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > Math.abs(dz)) {
    // Strongest jerk is lateral
    action = dx > 0 ? 'tap' : 'double_tap'
  }

  if (action && callback) {
    lastGestureTime = now
    callback(action)
  }
}

export async function startHeadGestures(bridge: EvenAppBridge, cb: GestureCallback, log?: (msg: string) => void): Promise<boolean> {
  callback = cb
  logCallback = log ?? null
  sampleCount = 0
  lastGestureTime = 0

  try {
    // Try to enable IMU via the generic callEvenApp escape hatch
    // since imuControl isn't in the typed SDK yet
    logCallback?.('Attempting IMU start via callEvenApp...')
    const result = await (bridge as any).callEvenApp('imuControl', {
      isOpen: true,
      reportFrq: REPORT_FREQ_MS,
    })
    logCallback?.(`IMU callEvenApp result: ${JSON.stringify(result)}`)

    if (result === false || result === 'error') {
      logCallback?.('IMU not available')
      return false
    }

    // Listen for ALL events and log them to find IMU data format
    bridge.onEvenHubEvent((event: any) => {
      // Log every event to help discover the IMU data format
      const keys = Object.keys(event || {}).filter(k => event[k] != null)
      if (keys.length > 0) {
        const preview = keys.map(k => {
          const v = event[k]
          if (typeof v === 'object') return `${k}:{${Object.keys(v).join(',')}}`
          return `${k}:${String(v).slice(0, 20)}`
        }).join(' ')
        logCallback?.(`EVT: ${preview}`)
      }

      // Try every possible IMU data shape
      const imuData = event.imuEvent ?? event.sensorEvent ?? event.motionEvent
        ?? event.imu ?? event.sensor ?? event.motion ?? event.accelerometer
      if (imuData) {
        const x = imuData.x ?? imuData.accX ?? imuData.ax ?? 0
        const y = imuData.y ?? imuData.accY ?? imuData.ay ?? 0
        const z = imuData.z ?? imuData.accZ ?? imuData.az ?? 0
        logCallback?.(`IMU: x=${x.toFixed(2)} y=${y.toFixed(2)} z=${z.toFixed(2)}`)
        processImuData(x, y, z)
      }
    })

    active = true
    console.log('[HeadGestures] IMU started')
    return true
  } catch (err) {
    console.log('[HeadGestures] Failed to start IMU:', err)
    return false
  }
}

export async function stopHeadGestures(bridge: EvenAppBridge): Promise<void> {
  if (!active) return
  try {
    await (bridge as any).callEvenApp('imuControl', {
      isOpen: false,
      reportFrq: 0,
    })
  } catch {}
  active = false
  callback = null
  console.log('[HeadGestures] IMU stopped')
}

export function isHeadGesturesActive(): boolean {
  return active
}

/**
 * Adjust sensitivity. Lower = more sensitive, higher = less false positives.
 */
export function setJerkThreshold(value: number): void {
  (globalThis as any).__JERK_THRESHOLD = value
}
