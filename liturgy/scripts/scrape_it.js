// CLI wrapper around the shared Italian scraper.
//
// Usage:
//   node scripts/scrape_it.js <slug> [YYYY-MM-DD]

import { scrapeHour, IT_HOUR_SLUGS } from '../lib/scrape_it.js'

export { scrapeHour, IT_HOUR_SLUGS }
export { slugToUrl, prettyName } from '../lib/scrape_it.js'

function todayIso() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

import { fileURLToPath } from 'url'
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const slug = process.argv[2] || 'lodi'
  const date = process.argv[3] || todayIso()
  scrapeHour(slug, date).then(
    (r) => { console.log(JSON.stringify(r, null, 2)) },
    (e) => { console.error('Error:', e.message); process.exit(1) }
  )
}
