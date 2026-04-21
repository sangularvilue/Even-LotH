// English LotH fetcher — calls the deployed loth.grannis.xyz API.
// (The API itself wraps divineoffice.org's REST endpoint; reusing it avoids
// duplicating the HTML-processing logic from api/hour.js.)

import https from 'https'

const EN_BASE = 'https://loth.grannis.xyz'

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'LotH-Compare-Tool' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchJson(new URL(res.headers.location, url).href).then(resolve, reject)
        res.resume()
        return
      }
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) }
        catch (e) { reject(new Error('Bad JSON from ' + url + ': ' + e.message)) }
      })
      res.on('error', reject)
    }).on('error', reject)
  })
}

// date format: YYYYMMDD (no dashes — divineoffice format)
export async function fetchEnglishHoursList(yyyymmdd) {
  return fetchJson(`${EN_BASE}/api/hours?date=${yyyymmdd}`)
}

export async function fetchEnglishHour(slug, yyyymmdd) {
  return fetchJson(`${EN_BASE}/api/hour?slug=${encodeURIComponent(slug)}&date=${yyyymmdd}`)
}

// Map an English hour name (from the list endpoint) to our IT slug
export function englishNameToItalianSlug(name) {
  const n = (name || '').toLowerCase()
  if (n.includes('invitatory')) return 'invitatorio'
  if (n.includes('office of readings')) return 'ufficiodelleletture'
  if (n.includes('morning prayer') && !n.includes('midmorning')) return 'lodi'
  if (n.includes('midmorning')) return 'oramedia-terza'
  if (n.includes('midday')) return 'oramedia-sesta'
  if (n.includes('midafternoon')) return 'oramedia-nona'
  if (n.includes('evening prayer')) return 'vespri'
  if (n.includes('night prayer')) return 'compieta'
  return null
}

// CLI
import { fileURLToPath } from 'url'
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const arg = process.argv[2] || 'list'
  const date = process.argv[3] || (() => {
    const d = new Date()
    return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`
  })()

  if (arg === 'list') {
    fetchEnglishHoursList(date).then(
      (r) => console.log(JSON.stringify(r, null, 2)),
      (e) => { console.error('Error:', e.message); process.exit(1) }
    )
  } else {
    fetchEnglishHour(arg, date).then(
      (r) => console.log(JSON.stringify(r, null, 2)),
      (e) => { console.error('Error:', e.message); process.exit(1) }
    )
  }
}
