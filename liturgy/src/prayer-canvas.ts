import type { DisplayColumns, PrayerSection } from './types'

// ── Tile layout ──
// Image containers: max 200Ã100 each, max 4 containers per page.
// 1 column:  1Ã3 grid (200Ã288) + 1 event-capture list = 4 containers
// 2 columns: 2Ã2 grid (400Ã200) = 4 containers (no event capture; phone controls only)

export const MAX_TILE_WIDTH = 200
export const MAX_TILE_HEIGHT = 100

export type TileLayout = {
  cols: number
  rows: number
  tileWidth: number
  tileHeight: number
  canvasWidth: number
  viewportHeight: number
  totalTiles: number
  hasEventCapture: boolean
}

export function computeTileLayout(columns: DisplayColumns): TileLayout {
  if (columns === 2) {
    // 2Ã2 grid = 400Ã200, all 4 slots used by images.
    // Gestures still work — onEvenHubEvent fires on the bridge regardless.
    return {
      cols: 2, rows: 2,
      tileWidth: 200, tileHeight: 100,
      canvasWidth: 400, viewportHeight: 200,
      totalTiles: 4, hasEventCapture: false,
    }
  }
  // 1Ã3 grid = 200Ã288, 3 images + 1 event list (belt-and-suspenders)
  return {
    cols: 1, rows: 3,
    tileWidth: 200, tileHeight: 96,
    canvasWidth: 200, viewportHeight: 288,
    totalTiles: 3, hasEventCapture: true,
  }
}

const PAD_LEFT = 6
const PAD_RIGHT = 6
const FONT_FAMILY = '"Segoe UI", "Helvetica Neue", Arial, sans-serif'

export type FontSettings = {
  fontSize: number
  fontWeight: number
  letterSpacing: number
}

// ── Line model ──

type DisplayLine = {
  text: string
  type: 'text' | 'section' | 'blank'
}

// ── Pre-render all prayer text onto a tall off-screen canvas ──

export class PrayerCanvas {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  readonly totalHeight: number
  readonly layout: TileLayout

  constructor(sections: PrayerSection[], font: FontSettings, layout: TileLayout) {
    this.layout = layout
    const canvasWidth = layout.canvasWidth
    const textWidth = canvasWidth - PAD_LEFT - PAD_RIGHT

    const lineHeight = Math.round(font.fontSize * 1.5)
    const charsPerLine = Math.floor(textWidth / (font.fontSize * 0.52))
    const lines = buildDisplayLines(sections, charsPerLine)

    const topPad = 0
    const bottomPad = layout.viewportHeight
    this.totalHeight = topPad + lines.length * lineHeight + bottomPad

    this.canvas = document.createElement('canvas')
    this.canvas.width = canvasWidth
    this.canvas.height = this.totalHeight
    this.ctx = this.canvas.getContext('2d')!

    // Black background
    this.ctx.fillStyle = '#000'
    this.ctx.fillRect(0, 0, canvasWidth, this.totalHeight)

    // Render lines
    this.ctx.textBaseline = 'top'
    ;(this.ctx as any).letterSpacing = `${font.letterSpacing}px`
    let y = topPad

    for (const line of lines) {
      if (line.type === 'section') {
        // Keep section headers bold
        this.ctx.font = `600 ${font.fontSize}px ${FONT_FAMILY}`
        this.ctx.fillStyle = '#ccc'
      } else {
        this.ctx.font = `${font.fontWeight} ${font.fontSize}px ${FONT_FAMILY}`
        this.ctx.fillStyle = '#fff'
      }
      if (line.text) {
        this.ctx.fillText(line.text, PAD_LEFT, y)
      }
      y += lineHeight
    }
  }

  /** Maximum scrollY value (fully scrolled to end). */
  get maxScroll(): number {
    return Math.max(0, this.totalHeight - this.layout.viewportHeight)
  }

  /**
   * Extract one tile as a PNG ArrayBuffer.
   * tileIndex: linear index (row-major). For 2Ã2: 0=TL, 1=TR, 2=BL, 3=BR.
   */
  async getTilePng(scrollY: number, tileIndex: number): Promise<ArrayBuffer> {
    const { cols, tileWidth, tileHeight } = this.layout
    const col = tileIndex % cols
    const row = Math.floor(tileIndex / cols)
    const clampedY = Math.min(Math.max(0, Math.round(scrollY)), this.maxScroll)

    const srcX = col * tileWidth
    const srcY = clampedY + row * tileHeight

    const imageData = this.ctx.getImageData(srcX, srcY, tileWidth, tileHeight)

    const tmp = document.createElement('canvas')
    tmp.width = tileWidth
    tmp.height = tileHeight
    tmp.getContext('2d')!.putImageData(imageData, 0, 0)

    return new Promise<ArrayBuffer>((resolve, reject) => {
      tmp.toBlob(
        blob => {
          if (!blob) return reject(new Error('toBlob failed'))
          blob.arrayBuffer().then(resolve, reject)
        },
        'image/png',
      )
    })
  }
}

// ── Text â display lines ──

function buildDisplayLines(sections: PrayerSection[], charsPerLine: number): DisplayLine[] {
  const lines: DisplayLine[] = []

  for (const section of sections) {
    if (section.label) {
      lines.push({ text: '', type: 'blank' })
      lines.push({ text: `— ${section.label} —`, type: 'section' })
      lines.push({ text: '', type: 'blank' })
    }

    const rawLines = section.text
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0)

    for (const raw of rawLines) {
      for (const w of wordWrap(raw, charsPerLine)) {
        lines.push({ text: w, type: 'text' })
      }
    }
  }

  return lines
}

function wordWrap(text: string, max: number): string[] {
  if (text.length <= max) return [text]
  const result: string[] = []
  const words = text.split(' ')
  let cur = ''
  for (const w of words) {
    const candidate = cur ? `${cur} ${w}` : w
    if (candidate.length > max && cur) {
      result.push(cur)
      cur = w
    } else {
      cur = candidate
    }
  }
  if (cur) result.push(cur)
  return result.length > 0 ? result : [text]
}
