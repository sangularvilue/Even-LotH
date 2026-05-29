// Offline test: parse a saved Lezionario.php sample and print the
// section structure + a glasses-style render, so we can verify the
// scraper produces clean output without any network call.
//
//   node scripts/test_lezionario.js <path-to-sample.html>

import { readFileSync } from 'fs'
import { parseLezionario } from '../lib/scrape_lezionario.js'

const path = process.argv[2]
if (!path) { console.error('usage: node scripts/test_lezionario.js <sample.html>'); process.exit(1) }

const html = readFileSync(path, 'utf8')
const result = parseLezionario(html, '2026-05-28', path)

console.log('NAME:', result.name)
console.log('SECTIONS:', result.sections.length)
console.log('='.repeat(60))

// Mimic liturgy-controller.ts formatLines() marker -> glasses-text mapping
function render(line) {
  return line
    .replace(/\{r\}(.+?)\{\/r\}/g, '[$1]')
    .replace(/\{i\}(.+?)\{\/i\}/g, '($1)')
    .replace(/\{\/?\w+\}/g, '')
}

for (const s of result.sections) {
  console.log(`\n== ${s.label || '(intro)'} ==  [type=${s.type}]`)
  for (const line of s.text.split('\n')) {
    console.log('   ' + render(line))
  }
}
