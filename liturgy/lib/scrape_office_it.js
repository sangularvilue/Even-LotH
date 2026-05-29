// Italian Office scraper — liturgiadelleore.it (CEI, lachiesa.it).
//
// Replaces the rosarioonline scrape as the Italian Office source, unifying all
// Italian content (Office + Lezionario) on liturgiadelleore.it. ONE request to
// SoloTestoGiorno.php returns all 8 hours wrapped in <LInv>…<LCom>.
//
// CRITICAL param: addizionemultipla MUST be the EMPTY string. With any other
// value (e.g. "false") the server returns only the day-independent skeleton
// (Gloria + Magnificat) with empty propers — the app sends "" (AddizioneMultipla="").
//
// Output shape matches scrape_it.js / scrape_lezionario.js so the existing
// liturgy-controller renderer consumes it unchanged.

import https from 'https'

// jsdom is ESM-only; dynamic import avoids Vercel's bundler emitting require().
let _JSDOM = null
async function getJSDOM() {
  if (!_JSDOM) ({ JSDOM: _JSDOM } = await import('jsdom'))
  return _JSDOM
}

const BASE = 'https://www.liturgiadelleore.it/testo/SoloTestoGiorno.php'

// slug → { code: <Lxxx> marker, ora: numeric hour param }
const SLUG_MAP = {
  'invitatorio': { code: 'Inv', ora: 0 },
  'ufficiodelleletture': { code: 'Uff', ora: 1 },
  'lodi': { code: 'Lod', ora: 2 },
  'oramedia-terza': { code: 'Om3', ora: 3 },
  'oramedia-sesta': { code: 'Om6', ora: 4 },
  'oramedia-nona': { code: 'Om9', ora: 5 },
  'vespri': { code: 'Ves', ora: 6 },
  'compieta': { code: 'Com', ora: 7 },
}

// Section headers (uppercased) — a Risalto label starting with one of these
// begins a new section; other short Risalto labels ("1 ant.", "Ant. al Magn.")
// are inline antiphon cues.
const SECTION_KEYWORDS = [
  'INNO', 'SALMODIA', 'SALMO', 'CANTICO', 'PRIMA LETTURA', 'SECONDA LETTURA',
  'LETTURA BREVE', 'LETTURA', 'RESPONSORIO BREVE', 'RESPONSORIO', 'RESPONSORIO BIBLICO',
  'INVOCAZIONI', 'INTERCESSIONI', 'INVOCAZIONE', 'INTERCESSIONE',
  'ORAZIONE', 'PADRE NOSTRO', 'ANTIFONA', 'ESAME DI COSCIENZA', 'BENEDIZIONE',
  'CONCLUSIONE', 'VERSETTO',
]

function toItDate(date) {
  if (/^\d{8}$/.test(date)) return `${date.slice(6, 8)}/${date.slice(4, 6)}/${date.slice(0, 4)}`
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) { const [y, m, d] = date.split('-'); return `${d}/${m}/${y}` }
  return date
}
function toIsoDate(date) {
  if (/^\d{8}$/.test(date)) return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(date)) { const [d, m, y] = date.split('/'); return `${y}-${m}-${d}` }
  return date
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 LotH-Even-G2', 'X-Requested-With': 'XMLHttpRequest', 'Referer': 'https://www.liturgiadelleore.it/' } }, (res) => {
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

// One request returns all hours; cache the day's full HTML across warm calls.
const _dayCache = new Map()
async function fetchOfficeDay(itDate, ora) {
  if (_dayCache.has(itDate)) return _dayCache.get(itDate)
  const url = `${BASE}?data=${encodeURIComponent(itDate)}&ora=${ora}`
    + `&memoriafacoltativa=false&addizionemultipla=&abbreviazione=false&biennale=false`
  const html = await httpGet(url)
  _dayCache.set(itDate, html)
  return html
}

const clean = (s) => (s || '').replace(/ /g, ' ').replace(/[ \t]+/g, ' ').trim()

function isSectionHeader(label) {
  const u = label.toUpperCase()
  return SECTION_KEYWORDS.some((k) => u === k || u.startsWith(k + ' ') || u.startsWith(k + '\n'))
}

// Walk a hour block's DOM, emitting marker text split into sections.
function convertBlock(doc, root, slug, name, iso, url) {
  const sections = []
  let cur = { type: 'intro', label: name, text: '' }
  const pushCur = () => { if (cur && cur.text.trim()) sections.push(cur) }
  const add = (s) => { if (s) cur.text += s }

  const FONT_MARK = {
    Rosso: (t) => `\n{r}${t}{/r}\n`,
    Citazione: (t) => `\n{i}${t}{/i}\n`,
    Spiegazione: (t) => `\n{i}${t}{/i}\n`,
    Rubrica: (t) => `\n{r}${t}{/r}\n`,
  }

  const walk = (node) => {
    for (const n of node.childNodes) {
      if (n.nodeType === 3) { add(n.textContent.replace(/ /g, ' ')); continue } // text
      if (n.nodeType !== 1) continue
      const tag = n.tagName.toUpperCase()
      if (tag === 'BR') { add('\n'); continue }
      if (tag === 'FONT') {
        const cls = n.getAttribute('class') || ''
        const txt = clean(n.textContent)
        if (cls === 'Titolo' || cls === 'Ora') continue // day title / hour name — skip (name already set)
        if (cls === 'EvidenzaVersetto') {
          const raw = n.textContent
          if (/℣/.test(raw)) add(' V/ ')        // ℣
          else if (/℞/.test(raw)) add(' R/ ')   // ℞
          else if (/✝|†/.test(raw)) add('')  // cross
          else add(txt ? ' ' + txt + ' ' : '')
          continue
        }
        if (cls === 'Risalto') {
          if (!txt) continue
          if (isSectionHeader(txt)) { pushCur(); cur = { type: txt.toLowerCase().replace(/\s+/g, '-'), label: txt, text: '' } }
          else add(`\n{r}${txt}{/r} `) // antiphon cue ("1 ant.", "Ant. al Magn.")
          continue
        }
        if (FONT_MARK[cls]) { if (txt) add(FONT_MARK[cls](txt)); continue }
        // unknown FONT class — keep its text/markup
        walk(n); continue
      }
      // other elements (B, I, SPAN…) — recurse
      walk(n)
    }
  }
  walk(root)
  pushCur()

  // normalize whitespace per section
  for (const s of sections) {
    s.text = s.text.split('\n').map((l) => clean(l)).filter((l) => l.length > 0).join('\n').replace(/\n{3,}/g, '\n\n')
  }
  return { slug, name, date: iso, url, sections: sections.filter((s) => s.text.trim().length > 0) }
}

export async function parseOfficeHour(fullHtml, slug, iso) {
  const info = SLUG_MAP[slug]
  if (!info) throw new Error(`Unknown Italian office slug: ${slug}`)
  const m = fullHtml.match(new RegExp(`<L${info.code}>([\\s\\S]*?)</L${info.code}>`))
  if (!m) throw new Error(`Hour block <L${info.code}> not found`)
  const JSDOM = await getJSDOM()
  const dom = new JSDOM(`<!DOCTYPE html><body><div id="b">${m[1]}</div></body>`)
  const root = dom.window.document.getElementById('b')
  const name = prettyName(slug)
  return convertBlock(dom.window.document, root, slug, name, iso, `${BASE}?data=${encodeURIComponent(toItDate(iso))}`)
}

export async function scrapeOfficeHour(slug, date) {
  const info = SLUG_MAP[slug]
  if (!info) throw new Error(`Unknown Italian office slug: ${slug}`)
  const iso = toIsoDate(date)
  const itDate = toItDate(date)
  const full = await fetchOfficeDay(itDate, info.ora)
  if (!/CLASS=/i.test(full)) throw new Error('Unexpected Office response (no content)')
  return parseOfficeHour(full, slug, iso)
}

export function prettyName(slug) {
  switch (slug) {
    case 'invitatorio': return 'Invitatorio'
    case 'ufficiodelleletture': return 'Ufficio delle letture'
    case 'lodi': return 'Lodi'
    case 'oramedia-terza': return 'Ora Media — Terza'
    case 'oramedia-sesta': return 'Ora Media — Sesta'
    case 'oramedia-nona': return 'Ora Media — Nona'
    case 'vespri': return 'Vespri'
    case 'compieta': return 'Compieta'
    default: return slug
  }
}

export const IT_OFFICE_SLUGS = Object.keys(SLUG_MAP)

// The liturgical day title from liturgiadelleore's own calendar (the first
// non-empty <FONT CLASS=Titolo>, e.g. "OTTAVA SETTIMANA DEL TEMPO ORDINARIO - Venerdì").
export async function extractDayTitle(date) {
  const itDate = toItDate(date)
  const full = await fetchOfficeDay(itDate, 2)
  const accents = {
    '&agrave;': 'à', '&egrave;': 'è', '&eacute;': 'é', '&igrave;': 'ì', '&ograve;': 'ò', '&ugrave;': 'ù',
    '&Agrave;': 'À', '&Egrave;': 'È', '&Igrave;': 'Ì', '&Ograve;': 'Ò', '&Ugrave;': 'Ù', '&nbsp;': ' ',
  }
  const decode = (s) => s
    .replace(/&[A-Za-z]+;/g, (e) => accents[e] || '')
    .replace(/&#x?[0-9a-f]+;/gi, '')
  const re = /<FONT\s+CLASS=Titolo>([\s\S]*?)<\/FONT>/gi
  let m
  while ((m = re.exec(full)) !== null) {
    const t = clean(decode(m[1].replace(/<[^>]+>/g, '')))
    if (t) return t
  }
  return ''
}
