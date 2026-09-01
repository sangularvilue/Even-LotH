// End-to-end: fetch today's real offices and page them exactly as the glasses
// will, then assert every line fits the 564px line and no page overflows.
import { paginateSections } from '../src/paginate'
import { toneLevel } from '../src/tone'
import { getTextWidth } from '@evenrealities/pretext'

const BASE = 'https://loth.grannis.xyz'
const TEXT_W = 564
const LINES = 7

function dstr(d = new Date()) {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
}

const date = dstr()
const idx = await (await fetch(`${BASE}/api/hours?date=${date}&tz=${new Date().getTimezoneOffset()}`)).json()
console.log(`${idx.hours.length} hours for ${date}: ${idx.hours.map((h: any) => h.name).join(', ')}\n`)

let overflow = 0, overlong = 0, totalPages = 0, totalLines = 0
const tones: Record<string, number> = {}

for (const h of idx.hours) {
  const hour = await (await fetch(`${BASE}/api/hour/${h.slug}?date=${h.date || date}`)).json()
  const { pages, pageLines } = paginateSections(hour.sections, TEXT_W, LINES)
  totalPages += pages.length
  for (const [pi, page] of pageLines.entries()) {
    if (page.length > LINES) { overlong++; console.log(`  !! ${h.name} p${pi + 1}: ${page.length} lines`) }
    for (const line of page) {
      totalLines++
      tones[line.tone] = (tones[line.tone] || 0) + 1
      const w = getTextWidth(line.text)
      if (w > TEXT_W) { overflow++; console.log(`  !! ${h.name} p${pi + 1}: ${w}px  "${line.text}"`) }
    }
  }
  console.log(`${String(pages.length).padStart(3)} pages  ${h.name}`)
}

console.log(`\ntotals: ${totalPages} pages, ${totalLines} lines`)
console.log('tones:', Object.entries(tones).map(([t, n]) => `${t}=${n}(L${toneLevel(t as any)})`).join(' '))
console.log(`lines over ${TEXT_W}px: ${overflow}`)
console.log(`pages over ${LINES} lines: ${overlong}`)
if (overflow || overlong) process.exit(1)
console.log('\nOK')
