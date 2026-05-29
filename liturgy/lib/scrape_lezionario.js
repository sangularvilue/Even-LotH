// Italian Lezionario (daily Mass readings) scraper — liturgiadelleore.it (CEI / lachiesa.it).
//
// PROTOTYPE. Suggested by beta tester Alina: this site exposes the Lezionario
// (Mass of the day: readings, responsorial psalm, gospel acclamation, gospel),
// which the Liturgy of the Hours Office source (rosarioonline) does not have.
//
// Unlike scrape_it.js (which scrapes server-rendered HTML pages), this site is
// an AngularJS SPA whose content comes from a clean data endpoint:
//   GET https://www.liturgiadelleore.it/lezionario/Lezionario.php?data=DD/MM/YYYY
// It returns an HTML fragment with semantic FONT CLASS names that map almost
// 1:1 onto the {r}/{i} markers liturgy-controller.ts already renders.
//
// Imported by:
//   - api/hour_it.js     (when slug === 'lezionario')
//   - scripts/test_lezionario.js (offline parser test against a saved sample)
//
// Output shape matches scrapeHour() from scrape_it.js so the existing
// liturgy-controller.ts renderer consumes it unchanged:
//   { slug, name, date, url, sections: [{ type, label, text }] }

import https from 'https'

const LEZIONARIO_URL = 'https://www.liturgiadelleore.it/lezionario/Lezionario.php'

// YYYYMMDD or YYYY-MM-DD -> DD/MM/YYYY (the format the endpoint expects)
export function toItDate(date) {
  let y, m, d
  if (/^\d{8}$/.test(date)) {
    y = date.slice(0, 4); m = date.slice(4, 6); d = date.slice(6, 8)
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    [y, m, d] = date.split('-')
  } else {
    return date // already DD/MM/YYYY or unknown — pass through
  }
  return `${d}/${m}/${y}`
}

// DD/MM/YYYY or YYYYMMDD -> YYYY-MM-DD (canonical, for the returned object)
export function toIsoDate(date) {
  if (/^\d{8}$/.test(date)) return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(date)) {
    const [d, m, y] = date.split('/')
    return `${y}-${m}-${d}`
  }
  return date
}

function fetchText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 LotH-Even-G2' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchText(new URL(res.headers.location, url).href).then(resolve, reject)
        res.resume()
        return
      }
      if (res.statusCode && res.statusCode >= 400) {
        reject(new Error(`HTTP ${res.statusCode} from ${url}`))
        res.resume()
        return
      }
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
      res.on('error', reject)
    }).on('error', reject)
  })
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    // named Italian accents
    .replace(/&agrave;/g, 'à').replace(/&egrave;/g, 'è').replace(/&eacute;/g, 'é')
    .replace(/&igrave;/g, 'ì').replace(/&ograve;/g, 'ò').replace(/&ugrave;/g, 'ù')
    .replace(/&Agrave;/g, 'À').replace(/&Egrave;/g, 'È').replace(/&Eacute;/g, 'É')
    .replace(/&Igrave;/g, 'Ì').replace(/&Ograve;/g, 'Ò').replace(/&Ugrave;/g, 'Ù')
    .replace(/&laquo;/g, '«').replace(/&raquo;/g, '»')
    // numeric: drop the liturgical glyphs we handle separately, then strip the rest
    .replace(/&#8212;|&#x2014;/g, '—').replace(/&#8211;|&#x2013;/g, '–')
    .replace(/&#8230;|&#x2026;/g, '…')
    .replace(/&#\d+;/g, '').replace(/&#x[0-9a-fA-F]+;/g, '')
    .replace(/&[a-zA-Z]+;/g, '')
}

function stripTags(s) { return s.replace(/<[^>]*>/g, '') }

// Section header in the Lezionario markup is a drop-cap nest:
//   <FONT CLASS=lezionarioRisalto><FONT CLASS=Risalto>P<FONT CLASS=Minuscoletto>RIMA LETTURA</FONT></FONT></FONT>
// which reassembles to "PRIMA LETTURA".
const SECTION_MARK = 'SEC'
const TITLE_MARK = 'TITLE'

// Convert the raw HTML fragment into marker text, then split into sections.
export function parseLezionario(rawHtml, isoDate, url = '') {
  let html = rawHtml

  // Day/season title
  let title = ''
  html = html.replace(/<FONT\s+CLASS=Titolo>([\s\S]*?)<\/FONT>/gi, (_, inner) => {
    title = decodeEntities(stripTags(inner)).replace(/\s+/g, ' ').trim()
    return `\n${TITLE_MARK}\n`
  })

  // Section headers (drop-cap nest) -> SECTION_MARK + UPPERCASE label
  html = html.replace(
    /<FONT\s+CLASS=lezionarioRisalto>([\s\S]*?)<\/FONT>\s*<\/FONT>\s*<\/FONT>/gi,
    (_, inner) => {
      const label = decodeEntities(stripTags(inner)).replace(/\s+/g, ' ').trim().toUpperCase()
      return `\n${SECTION_MARK}${label}\n`
    }
  )

  // Pericope theme line -> italic
  html = html.replace(/<FONT\s+CLASS=Citazione>([\s\S]*?)<\/FONT>/gi, (_, inner) => {
    const t = decodeEntities(stripTags(inner)).replace(/\s+/g, ' ').trim()
    return t ? `\n{i}${t}{/i}\n` : ''
  })

  // Response / gospel marks
  html = html.replace(/<FONT\s+CLASS=EvidenzaVersetto>([\s\S]*?)<\/FONT>/gi, (_, inner) => {
    const t = inner
    if (/211e|211E|℞/.test(t)) return ' R/ '   // ℞ responsorial mark
    if (/271d|271D|✝/.test(t)) return ''        // ✝ gospel cross — drop
    return ''
  })

  // Rosso = references / rubrics. A lone bullet (•) is dropped; real refs -> {r}.
  html = html.replace(/<FONT\s+CLASS=Rosso>([\s\S]*?)<\/FONT>/gi, (_, inner) => {
    const t = decodeEntities(stripTags(inner)).replace(/[••]/g, '').replace(/\s+/g, ' ').trim()
    return t ? `\n{r}${t}{/r}\n` : ''
  })

  // Any other FONT spans -> just their text
  html = html.replace(/<\/?FONT[^>]*>/gi, '')

  // Bold (scripture source line, refrains) -> plain
  html = html.replace(/<\/?B>/gi, '')

  html = html.replace(/<br\s*\/?>/gi, '\n')
  html = stripTags(html)
  html = decodeEntities(html)
  html = html.replace(/\t/g, ' ').replace(/ {2,}/g, ' ').replace(/\n{3,}/g, '\n\n')

  // ── group into sections ──
  const rawLines = html.split('\n').map((l) => l.trim()).filter((l) => l.length > 0)

  const sections = []
  let current = { type: 'intro', label: '', text: '' }
  const pushCurrent = () => { if (current && current.text.trim()) sections.push(current) }

  for (const line of rawLines) {
    if (line === TITLE_MARK) continue
    if (line.startsWith(SECTION_MARK)) {
      pushCurrent()
      const label = line.slice(SECTION_MARK.length).trim()
      current = { type: label.toLowerCase().replace(/\s+/g, '-'), label, text: '' }
    } else {
      current.text += (current.text ? '\n' : '') + line
    }
  }
  pushCurrent()

  return {
    slug: 'lezionario',
    name: title || 'Lezionario',
    date: isoDate,
    url,
    sections,
  }
}

export async function scrapeLezionario(date) {
  const itDate = toItDate(date)
  const iso = toIsoDate(date)
  const url = `${LEZIONARIO_URL}?data=${encodeURIComponent(itDate)}`
  const html = await fetchText(url)
  if (!/CLASS=/i.test(html)) throw new Error('Unexpected Lezionario response (no content)')
  return parseLezionario(html, iso, url)
}
