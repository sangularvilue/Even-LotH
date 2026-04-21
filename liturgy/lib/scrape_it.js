// Italian CEI Liturgia delle Ore scraper (rosarioonline.altervista.org)
//
// Shared library imported by:
//   - api/hour_it.js       (Vercel serverless endpoint)
//   - api/hours_it.js      (Vercel serverless endpoint — just uses IT_HOUR_SLUGS)
//   - scripts/scrape_it.js (CLI wrapper)
//   - scripts/compare_two_weeks.js (bulk comparison tool)
//
// Produces output with the same semantic markers ({r}/{ant}/{i}) as the
// English api/hour.js, so the existing liturgy-controller.ts renderer
// can consume either language unchanged.

import https from 'https'

export const IT_HOUR_SLUGS = [
  'invitatorio',
  'ufficiodelleletture',
  'lodi',
  'oramedia-terza',
  'oramedia-sesta',
  'oramedia-nona',
  'vespri',
  'compieta',
]

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

// Accept either YYYY-MM-DD or YYYYMMDD; return YYYY-MM-DD (the rosarioonline format)
export function normalizeDate(date) {
  if (!date) return date
  if (/^\d{8}$/.test(date)) return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`
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

// slug → URL path
export function slugToUrl(slug, date) {
  const base = 'https://rosarioonline.altervista.org/index.php/liturgiadelleore'
  if (slug.startsWith('oramedia-')) {
    const which = slug.slice('oramedia-'.length) // terza/sesta/nona
    return `${base}/oramedia/it/${which}/${date}`
  }
  return `${base}/${slug}/it/${date}`
}

// ── HTML → semantic-marker text ──

// Extract the prayer content div: <div id="testo"> ... </div>
// Walks tag depth to handle any nested divs correctly.
function extractTesto(html) {
  const start = html.indexOf('id="testo"')
  if (start < 0) return ''
  const openEnd = html.indexOf('>', start)
  if (openEnd < 0) return ''
  let depth = 1
  let i = openEnd + 1
  const tagRe = /<(\/?)(div)\b[^>]*>/gi
  tagRe.lastIndex = i
  let m
  while ((m = tagRe.exec(html)) !== null) {
    if (m[1] === '/') {
      depth--
      if (depth === 0) return html.slice(openEnd + 1, m.index)
    } else {
      depth++
    }
  }
  return html.slice(openEnd + 1)
}

// The site's first h1 is the navbar brand "Santo Rosario on line"; the
// content h1 always has class="text-center".
function extractPageTitle(html) {
  const m = html.match(/<h1[^>]*class="[^"]*text-center[^"]*"[^>]*>\s*([\s\S]*?)\s*<\/h1>/i)
  if (!m) return ''
  return decodeEntities(stripTags(m[1])).trim()
}

function extractSeasonLine(html) {
  const m = html.match(/<h2[^>]*class="[^"]*text-center[^"]*"[^>]*>\s*([\s\S]*?)\s*<\/h2>/i)
  if (!m) {
    const m2 = html.match(/<h2[^>]*>\s*([\s\S]*?)\s*<\/h2>/i)
    if (!m2) return ''
    return decodeEntities(stripTags(m2[1])).trim()
  }
  return decodeEntities(stripTags(m[1])).trim()
}

function stripTags(s) { return s.replace(/<[^>]*>/g, '') }

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#8212;/g, '—')
    .replace(/&#8211;/g, '–')
    .replace(/&#8217;/g, '’')
    .replace(/&#8216;/g, '‘')
    .replace(/&#8220;/g, '“')
    .replace(/&#8221;/g, '”')
    .replace(/&#171;/g, '«')
    .replace(/&#187;/g, '»')
    .replace(/&#8230;/g, '…')
    .replace(/&#\d+;/g, '')
    .replace(/&[a-zA-Z]+;/g, '')
}

function processHtml(rawHtml) {
  let html = rawHtml

  html = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
  html = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')

  // Red rubric spans: <span class="litore_Rosso">...</span>
  html = html.replace(
    /<span[^>]*class="[^"]*litore_Rosso[^"]*"[^>]*>([\s\S]*?)<\/span>/gi,
    (_, inner) => {
      let text = inner.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, '').trim()
      text = decodeEntities(text).replace(/\s+/g, ' ').trim()
      if (!text) return ''
      if (/^(I{1,3}V?|IV|V|VI{0,3}|[0-9]+|)\s*Antifona/i.test(text) || /^Antifona\b/i.test(text)) {
        return '\n{ant}' + text + '{/ant}\n'
      }
      return '\n\n{r}' + text + '{/r}\n'
    }
  )

  // Ufficio delle letture reading headers. Exact-class matching to avoid
  // substring collisions (sottotitoloprimalettura ⊃ titoloprimalettura ⊃ primalettura).
  html = html.replace(
    /<span[^>]*class="(?:primalettura|secondalettura)"[^>]*>([\s\S]*?)<\/span>/gi,
    (_, inner) => {
      const text = decodeEntities(stripTags(inner)).replace(/\s+/g, ' ').trim()
      if (!text) return ''
      return '\n\n{r}' + text.toUpperCase() + '{/r}\n'
    }
  )
  html = html.replace(
    /<span[^>]*class="(?:sottotitoloprimalettura|sottotitolosecondalettura)"[^>]*>([\s\S]*?)<\/span>/gi,
    (_, inner) => {
      const text = decodeEntities(stripTags(inner)).replace(/\s+/g, ' ').trim()
      if (!text) return ''
      return '\n{i}' + text + '{/i}\n'
    }
  )
  html = html.replace(
    /<span[^>]*class="(?:titoloprimalettura|titolosecondalettura|titolorespprimalettura|titolorespsecondalettura)"[^>]*>([\s\S]*?)<\/span>/gi,
    (_, inner) => {
      const text = decodeEntities(stripTags(inner)).replace(/\s+/g, ' ').trim()
      if (!text) return ''
      return '\n\n{r}' + text + '{/r}\n'
    }
  )

  // Scripture-ref subtitle under psalm/canticle headings
  html = html.replace(
    /<span[^>]*class="[^"]*litore_sottotitolo[^"]*"[^>]*>([\s\S]*?)<\/span>/gi,
    (_, inner) => {
      const text = decodeEntities(stripTags(inner)).replace(/\s+/g, ' ').trim()
      if (!text) return ''
      return '\n{i}' + text + '{/i}\n'
    }
  )

  // <em> — rubrics/instructions in italic
  html = html.replace(
    /<em>([\s\S]*?)<\/em>/gi,
    (_, inner) => {
      const text = decodeEntities(stripTags(inner).replace(/<br\s*\/?>/gi, ' ')).replace(/\s+/g, ' ').trim()
      if (!text) return ''
      return '{i}' + text + '{/i}'
    }
  )

  // <strong>Padre nostro.</strong> becomes its own section heading
  html = html.replace(
    /<strong>\s*Padre\s+nostro\.?\s*<\/strong>/gi,
    '\n\n{r}PADRE NOSTRO{/r}\n'
  )
  html = html.replace(/<\/?strong>/gi, '')

  html = html.replace(/<br\s*\/?>/gi, '\n')
  html = stripTags(html)
  html = decodeEntities(html)

  html = html
    .replace(/\t/g, ' ')
    .replace(/ {2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')

  return html
}

const JUNK_PATTERNS = [
  /^https?:\/\//i,
  /^Privacy Policy/i,
  /^Personalizza tracciamento/i,
  /^Incrementa Font/i,
  /^Pagina Principale/i,
  /^Liturgia delle Ore$/i,
  /^document\./i, /^window\./i, /^function\s*\(/,
  /^\.[a-z-]+\s*\{/i, /^\{\s*$/, /^\}\s*$/,
]

function isJunkLine(line) {
  const t = line.trim()
  if (!t) return false
  return JUNK_PATTERNS.some((re) => re.test(t))
}

const SECTION_KEYWORDS = [
  'CANTICO DI ZACCARIA',
  'CANTICO DELLA BEATA VERGINE',
  'CANTICO DI SIMEONE',
  'LETTURA BREVE',
  'SECONDA LETTURA',
  'PRIMA LETTURA',
  'RESPONSORIO BREVE',
  'RESPONSORIO',
  'ANTIFONA AL BENEDICTUS',
  'ANTIFONA AL MAGNIFICAT',
  'ANTIFONA AL NUNC DIMITTIS',
  'INTERCESSIONE',
  'INTERCESSIONI',
  'INVOCAZIONE',
  'INVOCAZIONI',
  'PREGHIERA DEL SIGNORE',
  'ORAZIONE',
  'PADRE NOSTRO',
  'INNO',
  'SALMODIA',
  'SALMO',
  'CANTICO',
  'ANTIFONA',
  'VERSETTO',
  'ESAME DI COSCIENZA',
  'BENEDIZIONE',
]

function classifySection(text) {
  const upper = text.trim().toUpperCase()
  for (const kw of SECTION_KEYWORDS) {
    if (upper === kw || upper.startsWith(kw + ' ') || upper.startsWith(kw + '\n')) {
      return { type: kw.toLowerCase().replace(/\s+/g, '-'), label: text.trim() }
    }
  }
  return { type: 'text', label: text.trim() }
}

function isSectionHeader(line) {
  const m = line.match(/^\{r\}(.+?)\{\/r\}\s*$/)
  if (!m) return false
  const label = m[1].trim().toUpperCase()
  if (label.length > 100) return false
  return SECTION_KEYWORDS.some(
    (kw) => label === kw || label.startsWith(kw + ' ') || label.startsWith(kw + '\n')
  )
}

function extractSectionLabel(line) {
  const m = line.match(/^\{r\}(.+?)\{\/r\}\s*$/)
  if (m) return m[1].trim()
  return line
}

export async function scrapeHour(slug, date) {
  const iso = normalizeDate(date)
  const url = slugToUrl(slug, iso)
  const html = await fetchText(url)
  const pageTitle = extractPageTitle(html)
  const seasonLine = extractSeasonLine(html)
  const testo = extractTesto(html)

  if (!testo) throw new Error('Could not find <div id="testo"> in page')

  const processed = processHtml(testo)
  const lines = processed.split('\n').map((l) => l.trim()).filter((l) => l.length > 0).filter((l) => !isJunkLine(l))

  const sections = []
  let current = null
  if (seasonLine) {
    current = { type: 'intro', label: prettyName(slug), text: seasonLine }
    sections.push(current)
    current = null
  }

  for (const line of lines) {
    if (isSectionHeader(line)) {
      const labelText = extractSectionLabel(line)
      const { type, label } = classifySection(labelText)
      current = { type, label, text: '' }
      sections.push(current)
    } else if (current) {
      current.text += (current.text ? '\n' : '') + line
    } else {
      current = { type: 'intro', label: prettyName(slug), text: line }
      sections.push(current)
    }
  }

  const filtered = sections.filter((s) => s.text.trim().length > 0)

  return { slug, name: pageTitle || prettyName(slug), date: iso, url, sections: filtered }
}
