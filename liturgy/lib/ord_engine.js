// Ordinariate Daily Office (Divine Worship: Daily Office) engine adapter.
//
// dwdo.uk is a fully client-side PWA: all its data (psalter, lectionary,
// canticles, responsories) and its calendar/assembly logic ship as static JS.
// Rather than reimplement the Easter/lectionary math, we run THEIR engine
// under jsdom server-side: seed the office.html DOM skeleton, inject their
// scripts, drive `changedate(date)` + `doOffice()`, and read the rendered
// #office / #compline HTML. scrape_ord.js then converts that to our markers.
//
// Source/courtesy: David Aldred's DW:DO (dwdo.uk). We fetch + run, we don't
// vendor. Liturgical content per date is stable, so callers cache hard.

import https from 'https'
import fs from 'fs'
import path from 'path'

// jsdom 29 is ESM-only; on Vercel the bundler turns a static import into a
// require(), which throws ERR_REQUIRE_ESM. A dynamic import() survives as a
// real ESM import in both CJS and ESM output.
let _JSDOM = null
async function getJSDOM() {
  if (!_JSDOM) ({ JSDOM: _JSDOM } = await import('jsdom'))
  return _JSDOM
}

const BASE = 'https://dwdo.uk/'

// Their <script> load order from office.html (data first, then logic).
const SCRIPT_FILES = [
  'jsdata/psalmsText.js',
  'jsdata/otherTexts.js',
  'jsdata/psalmsForDay.js',
  'jsdata/calReadings.js',
  'jsdata/endings.js',
  'jsdata/responsories.js',
  'js/ordo.js',
  'js/litDay.js',
  'js/officeFunctions.js',
  'js/pageFunctions.js',
]

const OFFICE_CODE = { mattins: 'm', evensong: 'e', compline: 'c' }

function httpGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 LotH-Even-G2' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        httpGet(new URL(res.headers.location, url).href).then(resolve, reject); res.resume(); return
      }
      if (res.statusCode >= 400) { reject(new Error(`HTTP ${res.statusCode} from ${url}`)); res.resume(); return }
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
      res.on('error', reject)
    }).on('error', reject)
  })
}

// Load a dwdo.uk file either from a local fixtures dir (offline test) or live.
function makeLoader(fixturesDir) {
  if (fixturesDir) {
    return async (rel) => fs.readFileSync(path.join(fixturesDir, rel.split('/').pop()), 'utf8')
  }
  return async (rel) => httpGet(BASE + rel)
}

// Cache the fetched engine sources across warm invocations.
let _cache = null
async function loadSources(fixturesDir) {
  if (fixturesDir) {
    const load = makeLoader(fixturesDir)
    const office = await load('office.html')
    const scripts = []
    for (const f of SCRIPT_FILES) scripts.push(await load(f))
    return { office, scripts }
  }
  if (_cache) return _cache
  const load = makeLoader(null)
  const office = await load('office.html')
  const scripts = []
  for (const f of SCRIPT_FILES) scripts.push(await load(f))
  _cache = { office, scripts }
  return _cache
}

// Strip every <script> (external + inline bootstrap) so the DOM is an inert
// skeleton; we inject the engine scripts ourselves and drive them by hand.
function stripScripts(html) {
  return html
    .replace(/<script\b[^>]*src=[^>]*>\s*<\/script>/gi, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
}

// Returns the rendered office HTML fragment for a date + office.
//   date: 'YYYY-MM-DD'  office: 'mattins' | 'evensong' | 'compline'
export async function renderOrdinariateHtml(date, office, { fixturesDir = null } = {}) {
  const code = OFFICE_CODE[office]
  if (!code) throw new Error(`Unknown office: ${office}`)

  const { office: officeHtml, scripts } = await loadSources(fixturesDir)
  const JSDOM = await getJSDOM()
  const dom = new JSDOM(stripScripts(officeHtml), {
    runScripts: 'dangerously',
    url: 'https://dwdo.uk/office.html',
    pretendToBeVisual: true,
  })
  const { window } = dom
  // Shims for browser-only calls their code makes during assembly.
  window.HTMLElement.prototype.scrollIntoView = () => {}
  window.alert = () => {}
  window.scrollTo = () => {}
  // Their scripts are chatty with console.log/debug — silence the page console
  // (keep error) so it doesn't pollute serverless logs / test output.
  window.console.log = window.console.warn = window.console.info = window.console.debug = () => {}

  // Inject engine scripts in order (top-level vars/functions land on window).
  for (const src of scripts) {
    const el = window.document.createElement('script')
    el.textContent = src
    window.document.head.appendChild(el)
  }

  // Drive their engine directly. We inline doOrdo()'s body but seed it from the
  // requested date (not Jan 1 of "now"), so initialise()'s Advent rollover picks
  // the correct LITURGICAL year — otherwise dates in the next church year (e.g.
  // Christmas after Advent) have no calendar entry and showLiturgicalDay crashes.
  const targetDiv = code === 'c' ? 'compline' : 'office'
  window.eval(`
    try {
      initialise(${JSON.stringify(date)}, true);  // sets ourDate + correct ordo year, builds empty calendar
      doSeasons(ourCountry);
      doFeasts(ourCountry);
      finaliseOrdo();
      layoutOrdo();
      ordoYear = year;
      showLiturgicalDay();                         // compute ld for the day
      ourOffice = ${JSON.stringify(code)};
      selectedOffice = ${JSON.stringify(code.toUpperCase())};
      doOffice();                                  // render the requested office
    } catch (e) { window.__ordError = String(e && e.stack || e) }
  `)
  if (window.__ordError) throw new Error('Ordinariate engine: ' + window.__ordError)

  const titleEl = window.document.getElementById('liturgicalDay')
  const collapse = (s) => (s || '').replace(/\s+/g, ' ').trim()
  const dayTitle = titleEl
    ? (Array.from(titleEl.children).map((c) => collapse(c.textContent)).filter(Boolean).join(' — ') || collapse(titleEl.textContent))
    : ''
  const html = window.document.getElementById(targetDiv).innerHTML

  // The raw lesson references (e.g. "Exodus 35:30-100"); used to fetch the
  // public-domain scripture text the source itself links out to.
  let readings = []
  try {
    readings = JSON.parse(window.eval('JSON.stringify((typeof ld !== "undefined" && ld.Readings) ? ld.Readings : [])'))
  } catch { /* leave empty */ }

  dom.window.close()
  return { html, dayTitle, readings }
}
