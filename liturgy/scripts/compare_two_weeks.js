// Two-week comparison: fetches Italian and English LotH for 14 days,
// caches to disk, then runs a structural diff.
//
// Usage: node scripts/compare_two_weeks.js [start-date YYYY-MM-DD]

import fs from 'fs'
import path from 'path'
import { scrapeHour, IT_HOUR_SLUGS } from './scrape_it.js'
import { fetchEnglishHoursList, fetchEnglishHour, englishNameToItalianSlug } from './scrape_en.js'

const CACHE_DIR = 'T:/US_TREASURIES/Will/Projects/_loh_compare_cache'
const IT_DIR = path.join(CACHE_DIR, 'it')
const EN_DIR = path.join(CACHE_DIR, 'en')
fs.mkdirSync(IT_DIR, { recursive: true })
fs.mkdirSync(EN_DIR, { recursive: true })

const SLEEP_MS = 250  // be polite to rosarioonline

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }

function formatDate(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return { iso: `${y}-${m}-${day}`, compact: `${y}${m}${day}` }
}

function addDays(d, n) {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

// ── Italian fetcher with disk cache ──

async function fetchItalianHourCached(slug, isoDate) {
  const file = path.join(IT_DIR, `${isoDate}_${slug}.json`)
  if (fs.existsSync(file)) {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  }
  try {
    const r = await scrapeHour(slug, isoDate)
    fs.writeFileSync(file, JSON.stringify(r, null, 2))
    return r
  } catch (e) {
    const err = { error: e.message, slug, date: isoDate }
    fs.writeFileSync(file, JSON.stringify(err, null, 2))
    return err
  }
}

// ── English fetcher with disk cache ──

async function fetchEnglishHoursCached(compactDate) {
  const file = path.join(EN_DIR, `${compactDate}_index.json`)
  if (fs.existsSync(file)) {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  }
  const r = await fetchEnglishHoursList(compactDate)
  fs.writeFileSync(file, JSON.stringify(r, null, 2))
  return r
}

async function fetchEnglishHourCached(slug, compactDate) {
  const file = path.join(EN_DIR, `${compactDate}_${slug}.json`)
  if (fs.existsSync(file)) {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  }
  try {
    const r = await fetchEnglishHour(slug, compactDate)
    fs.writeFileSync(file, JSON.stringify(r, null, 2))
    return r
  } catch (e) {
    const err = { error: e.message, slug, date: compactDate }
    fs.writeFileSync(file, JSON.stringify(err, null, 2))
    return err
  }
}

// ── Structural extraction ──

// Convert a Vulgate (CEI/Latin) psalm number to its Hebrew (English) equivalent.
// Returns an array because the mapping is sometimes 1→2 (e.g. Vulgate 9 → Hebrew 9 & 10).
//   Vulgate 1-8   → Hebrew 1-8       (same)
//   Vulgate 9     → Hebrew 9 + 10
//   Vulgate 10-112 → Hebrew n+1
//   Vulgate 113    → Hebrew 114 + 115
//   Vulgate 114-115 → both → Hebrew 116
//   Vulgate 116-145 → Hebrew n+1
//   Vulgate 146-147 → both → Hebrew 147
//   Vulgate 148-150 → same
function vulgateToHebrew(n) {
  n = parseInt(n, 10)
  if (n <= 8) return [n]
  if (n === 9) return [9, 10]
  if (n >= 10 && n <= 112) return [n + 1]
  if (n === 113) return [114, 115]
  if (n === 114 || n === 115) return [116]
  if (n >= 116 && n <= 145) return [n + 1]
  if (n === 146 || n === 147) return [147]
  return [n]
}

// Pull psalm numbers from BOTH section labels AND section text body
// (English groups multiple psalms under one PSALMODY section; Italian splits them.)
function extractPsalms(sections) {
  const psalms = []
  const seen = new Set()
  for (const s of sections) {
    const label = (s.label || '').replace(/\s+/g, ' ')
    const body = s.text || ''
    // Look in label first
    const reLabel = /(?:PSALM|SALMO)\s+(\d+)/gi
    let m
    while ((m = reLabel.exec(label)) !== null) {
      if (!seen.has(m[1])) { psalms.push(m[1]); seen.add(m[1]) }
    }
    // Look in body for {r}Psalm N rubrics or "PSALM N" headings (EN uses these inline)
    const reBody = /(?:\{r\}|\b)(?:PSALM|SALMO)\s+(\d+)/gi
    while ((m = reBody.exec(body)) !== null) {
      if (!seen.has(m[1])) { psalms.push(m[1]); seen.add(m[1]) }
    }
  }
  return psalms
}

function extractStructure(hour) {
  if (!hour || hour.error) return { error: hour && hour.error || 'no data', sectionCount: 0, sectionTypes: [], psalms: [], canticles: [], readings: [], totalWords: 0 }
  const sections = hour.sections || []
  const psalms = extractPsalms(sections)
  const sectionTypes = sections.map(s => s.type || 'unknown')

  // Extract scripture references from reading sections (best-effort)
  const readings = []
  for (const s of sections) {
    const label = (s.label || '').replace(/\s+/g, ' ').trim()
    const body = s.text || ''
    if (/lettura|reading|first reading|second reading/i.test(s.type || '') ||
        /lettura|reading/i.test(label)) {
      // look for scripture ref in label
      const refM = label.match(/(?:Rm|Rom|Eb|Heb|Cor|Ts|Tess|Pt|Pet|Gv|Jn|Mt|Lc|Lk|Mk|Mc|Ap|Rev|Gal|Eph|Ef|Phil|Fil|Col|Tim|Tit|Phlm|Fm|Jas|Gc|Pet|Pt|Jud|Acts|At|Sal|Ps|Is|Jer|Ger|Ez|Dan|Os|Hos|Joel|Gl|Am|Ob|Abd|Jon|Gn|Mic|Mi|Nah|Na|Hab|Ab|Sof|Zep|Hag|Ag|Zac|Zec|Mal|Ml|Sir|Wis|Sap|Bar|Ba|Tob|Tb|Jdt|Gdt|Mac|1\s*[A-Z][a-z]*|2\s*[A-Z][a-z]*)\s+\d+\s*[,:]\s*[\d\w\-\.,;ab\s]+/)
      if (refM) readings.push(refM[0].trim())
    }
  }

  return {
    sectionCount: sections.length,
    sectionTypes,
    psalms,
    readings,
    totalWords: sections.reduce((acc, s) => acc + (s.text || '').split(/\s+/).filter(w => w.length > 0).length, 0),
  }
}

// Compare IT (Vulgate) and EN (Hebrew) psalm lists
function comparePsalms(itPsalms, enPsalms) {
  if (itPsalms.length === 0 && enPsalms.length === 0) return { match: true, expected: [], actual: enPsalms }
  // Convert each IT psalm to its Hebrew equivalent(s)
  const expected = new Set()
  for (const p of itPsalms) {
    for (const h of vulgateToHebrew(p)) expected.add(String(h))
  }
  const actual = new Set(enPsalms.map(String))
  // EN matches if every IT-expected psalm appears in EN
  const missing = [...expected].filter(p => !actual.has(p))
  const extra = [...actual].filter(p => !expected.has(p))
  return {
    match: missing.length === 0 && extra.length === 0,
    closeMatch: missing.length === 0, // EN may have additional optional psalms (e.g. invitatory choices)
    expected: [...expected],
    actual: [...actual],
    missing,
    extra,
  }
}

// ── Main ──

async function main() {
  const startArg = process.argv[2]
  const start = startArg ? new Date(startArg + 'T00:00:00') : new Date()
  const days = []
  for (let i = 0; i < 14; i++) {
    const d = addDays(start, i)
    days.push(formatDate(d))
  }

  console.log(`Comparing ${days.length} days starting ${days[0].iso}\n`)

  const report = []

  for (const { iso, compact } of days) {
    console.log(`--- ${iso} ---`)

    // Fetch English index
    let enList
    try { enList = await fetchEnglishHoursCached(compact) }
    catch (e) { console.log(`  EN list error: ${e.message}`); continue }

    // Build EN slug map by italian-equivalent
    const enByItSlug = {}
    for (const h of enList.hours || []) {
      const itSlug = englishNameToItalianSlug(h.name)
      if (itSlug) enByItSlug[itSlug] = h
    }

    for (const itSlug of IT_HOUR_SLUGS) {
      const enInfo = enByItSlug[itSlug]
      const enHour = enInfo ? await fetchEnglishHourCached(enInfo.slug, compact) : null
      if (enInfo) await sleep(SLEEP_MS)

      const itHour = await fetchItalianHourCached(itSlug, iso)
      await sleep(SLEEP_MS)

      const enS = extractStructure(enHour)
      const itS = extractStructure(itHour)
      const cmp = comparePsalms(itS.psalms, enS.psalms)

      report.push({
        date: iso,
        hour: itSlug,
        enName: enInfo && enInfo.name,
        enSections: enS.sectionCount,
        itSections: itS.sectionCount,
        enPsalms: enS.psalms.join(','),
        itPsalms: itS.psalms.join(','),
        itAsHebrew: cmp.expected.join(','),
        psalmsMatch: cmp.match,
        psalmsCloseMatch: cmp.closeMatch,
        missing: cmp.missing.join(','),
        extra: cmp.extra.join(','),
        enWords: enS.totalWords,
        itWords: itS.totalWords,
        wordRatio: enS.totalWords ? +(itS.totalWords / enS.totalWords).toFixed(2) : null,
        enError: enS.error,
        itError: itS.error,
      })

      const status = (enS.error || itS.error) ? '✗' : (cmp.match ? '✓' : (cmp.closeMatch ? '≈' : '✗'))
      const itStr = itS.psalms.length ? itS.psalms.join('/') + (cmp.expected.length ? '→' + cmp.expected.join('/') : '') : '-'
      const enStr = enS.psalms.join('/') || '-'
      console.log(`  ${status} ${itSlug.padEnd(20)} IT[${itStr}] vs EN[${enStr}]${cmp.missing.length ? ' missing:' + cmp.missing : ''}${cmp.extra.length ? ' extra:' + cmp.extra : ''}`)
    }
  }

  // Write report
  const reportFile = path.join(CACHE_DIR, 'report.json')
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2))
  console.log(`\nReport written to ${reportFile}`)

  // Summary
  const total = report.length
  const errors = report.filter(r => r.enError || r.itError).length
  const exact = report.filter(r => r.psalmsMatch && !r.enError && !r.itError).length
  const close = report.filter(r => !r.psalmsMatch && r.psalmsCloseMatch && !r.enError && !r.itError).length
  const diff = report.filter(r => !r.psalmsCloseMatch && !r.enError && !r.itError).length
  console.log(`\nSUMMARY: ${total} hour-pairs | ${exact} exact | ${close} close (EN superset) | ${diff} differ | ${errors} errors`)
  if (diff > 0) {
    console.log(`\nMismatches needing review:`)
    for (const r of report) {
      if (!r.psalmsCloseMatch && !r.enError && !r.itError) {
        console.log(`  ${r.date} ${r.hour}: IT[${r.itPsalms}]→EN[${r.itAsHebrew}] vs got EN[${r.enPsalms}]; missing=${r.missing}`)
      }
    }
  }
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1) })
