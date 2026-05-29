// Offline test: parse the saved SoloTestoGiorno sample for every hour and print
// the rendered sections (marker → glasses-text), no network.
//   node scripts/test_office_it.js <sample.html> [slug]
import { readFileSync } from 'fs'
import { parseOfficeHour, IT_OFFICE_SLUGS } from '../lib/scrape_office_it.js'

const path = process.argv[2]
const only = process.argv[3]
const html = readFileSync(path, 'utf8')
const render = (l) => l.replace(/\{r\}(.+?)\{\/r\}/g, '[$1]').replace(/\{i\}(.+?)\{\/i\}/g, '($1)').replace(/\{\/?\w+\}/g, '')

for (const slug of (only ? [only] : IT_OFFICE_SLUGS)) {
  const r = await parseOfficeHour(html, slug, '2026-05-29')
  console.log('\n############ ' + slug + ' → ' + r.name + ' (' + r.sections.length + ' sections) ############')
  for (const s of r.sections) {
    console.log('== ' + (s.label || '(intro)') + ' ==')
    for (const line of s.text.split('\n')) console.log('   ' + render(line))
  }
}
