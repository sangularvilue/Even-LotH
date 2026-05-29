// Offline test: run the Ordinariate engine against locally-saved dwdo.uk
// fixtures and print the marker sections, with no network call.
//
//   node scripts/test_ord.js <fixturesDir> [YYYY-MM-DD] [mattins|evensong|compline]
//
// fixturesDir must contain (flat): office.html, psalmsText.js, otherTexts.js,
// psalmsForDay.js, calReadings.js, endings.js, responsories.js, ordo.js,
// litDay.js, officeFunctions.js, pageFunctions.js

import { renderOrdinariateHtml } from '../lib/ord_engine.js'
import { parseOrdinariate, enrichLessons } from '../lib/scrape_ord.js'
import { fetchKjvText } from '../lib/bible_kjv.js'

const dir = process.argv[2]
const date = process.argv[3] || '2026-05-28'
const office = process.argv[4] || 'mattins'
if (!dir) { console.error('usage: node scripts/test_ord.js <fixturesDir> [date] [office]'); process.exit(1) }

const { html, dayTitle, readings } = await renderOrdinariateHtml(date, office, { fixturesDir: dir })
const result = await parseOrdinariate(html, { slug: office, date, name: office, url: 'fixtures' })
await enrichLessons(result.sections, readings, fetchKjvText)

function render(line) {
  return line.replace(/\{r\}(.+?)\{\/r\}/g, '[$1]').replace(/\{i\}(.+?)\{\/i\}/g, '($1)').replace(/\{\/?\w+\}/g, '')
}

console.log('DAY:', dayTitle)
console.log('OFFICE:', result.name)
console.log('SECTIONS:', result.sections.length)
console.log('='.repeat(60))
for (const s of result.sections) {
  console.log(`\n== ${s.label || '(intro)'} ==`)
  for (const line of s.text.split('\n')) console.log('   ' + render(line))
}
