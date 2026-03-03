import type { PrayerSection } from './types'

// Native glasses renderer metrics (approximate)
export const LINE_HEIGHT = 18
export const DISPLAY_HEIGHT = 288
export const VISIBLE_LINES = Math.floor(DISPLAY_HEIGHT / LINE_HEIGHT) // 16
export const CHARS_PER_LINE = 58

/**
 * Break all sections into individual lines for teleprompter scrolling.
 * Returns a flat array of lines with section labels interspersed.
 */
export function buildLineArray(sections: PrayerSection[]): string[] {
  const lines: string[] = []

  for (const section of sections) {
    if (section.label) {
      lines.push('')
      lines.push(`--- ${section.label} ---`)
      lines.push('')
    }

    const sectionLines = section.text
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0)

    for (const line of sectionLines) {
      const wrapped = wordWrap(line, CHARS_PER_LINE)
      lines.push(...wrapped)
    }
  }

  return lines
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
