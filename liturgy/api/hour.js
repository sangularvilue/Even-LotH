import https from 'https'

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchJson(new URL(res.headers.location, url).href).then(resolve, reject)
        res.resume()
        return
      }
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())) }
        catch (e) { reject(new Error('Invalid JSON from divineoffice.org')) }
      })
      res.on('error', reject)
    }).on('error', reject)
  })
}

// ── Junk detection ──

const JUNK_PATTERNS = [
  /^https?:\/\//,
  /^Ribbon Placement/i,
  /^Liturgy of the Hours Vol/i,
  /^Christian Prayer:/i,
  /^Ordinary:\s*\d/i,
  /^Proper of Seasons:\s*\d/i,
  /^Psalter:.*/i,
  /^Page \d+/i,
  /^Sacred Silence\s*\(indicated/i,
  /^"[^"]*"\s*by\s/i,
  /^Title:/i, /^Composer:/i, /^Artist:/i,
  /^Used with permission/i, /^Text:/i, /^Tune:/i,
  /^Source:/i, /^Copyright/i, /^\u00A9/,
  /^All rights reserved/i, /^Music:/i, /^Words:/i,
  /^Meter:/i, /^Reprinted with/i, /^OneLicense/i, /^License #/i,
  /^Contribute now/i, /^If you feel called/i,
  /^Lenten offering/i, /^helps carry this prayer/i,
  /^Thank you for praying with us/i, /^to top$/i,
  /^Albums that contain/i,
  /^document\./i, /^window\./i, /^var /i, /^function\s*\(/,
  /^\.stc-/, /^\.wp-/, /^margin[-:]/, /^padding[-:]/,
  /^border[-:]/, /^text-align\s*:/, /^text-transform\s*:/,
  /^text-decoration\s*:/, /^font[-:]/, /^font\s*:/,
  /^color\s*:/, /^background[-:]/, /^background\s*:/,
  /^display\s*:/, /^position\s*:/, /^cursor\s*:/,
  /^width\s*:/, /^height\s*:/, /^overflow\s*:/,
  /^line-height\s*:/, /^letter-spacing\s*:/, /^box-/,
  /^float\s*:/, /^clear\s*:/, /^opacity\s*:/, /^z-index\s*:/,
  /^top\s*:/, /^left\s*:/, /^right\s*:/, /^bottom\s*:/,
  /^max-width/, /^min-width/, /^vertical-align/,
  /^white-space\s*:/, /^word-break/, /^list-style/,
  /^outline\s*:/, /^content\s*:/, /^appearance/,
  /^transition/, /^transform/, /^animation/,
  /^flex/, /^grid/, /^align-/, /^justify-/,
  /^gap\s*:/, /^order\s*:/, /^\}\s*$/, /^\{\s*$/,
  /^#[0-9a-f]{3,8}\s*[;,}]?$/i, /^\d+px[;,]?$/,
  /^none\s*;?$/, /^auto\s*;?$/, /^inherit\s*;?$/,
  /^!important/, /^@media/, /^@import/, /^-webkit-/, /^-moz-/,
  /^\*\s*\{/, /^html\s*\{/, /^body\s*\{/, // CSS rules
]

function isJunkLine(line) {
  const t = line.trim()
  if (!t) return false
  if (JUNK_PATTERNS.some((re) => re.test(t))) return true
  if (/^[a-z][-a-z]*\s*:\s*.+[;,]?\s*$/i.test(t) && t.length < 120 && !t.includes('\u2014')) return true
  return false
}

// ── HTML Processing ──

const SECTION_KEYWORDS = [
  'HYMN', 'PSALMODY', 'PSALM', 'CANTICLE', 'READING', 'RESPONSORY',
  'INTERCESSIONS', 'CONCLUDING PRAYER', 'DISMISSAL', 'INVITATORY',
  'ANTIPHON', 'BENEDICTUS', 'MAGNIFICAT', 'NUNC DIMITTIS',
  'TE DEUM', 'OFFICE OF READINGS', 'SECOND READING',
]

function processHtml(rawHtml) {
  let html = rawHtml

  // Remove hymn credit tables and audio players
  html = html.replace(/<div class="table-container">[\s\S]*?<\/div>/gi, '')
  html = html.replace(/<div class="powerpress_player">[\s\S]*?<\/div>/gi, '')
  // Remove style tags
  html = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')

  // Convert block-level tags to newlines
  html = html.replace(/<\/p>/gi, '\n\n')
  html = html.replace(/<p[^>]*>/gi, '\n')
  html = html.replace(/<br\s*\/?>/gi, '\n')
  html = html.replace(/<\/div>/gi, '\n')
  html = html.replace(/<\/h[1-6]>/gi, '\n\n')
  html = html.replace(/<h[1-6][^>]*>/gi, '\n')
  html = html.replace(/<\/li>/gi, '\n')
  html = html.replace(/<\/tr>/gi, '\n')

  // Process red spans — rubrics
  html = html.replace(
    /<span[^>]*color:\s*#ff0000[^>]*>([\s\S]*?)<\/span>/gi,
    (_, inner) => {
      let text = inner.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '').trim()
      text = text.replace(/&#8212;/g, '\u2014').replace(/&#8217;/g, '\u2019')
      if (!text) return ''
      if (text === '\u2014') return '\n{v}\u2014{/v} '
      if (/^Ant\.?\s*\d*/i.test(text)) return '\n{ant}' + text + '{/ant} '
      if (/^Psalm-prayer/i.test(text)) return '\n{r}[Psalm-prayer]{/r}\n'
      const firstLine = text.split('\n')[0].trim()
      const isUpperCase = firstLine.length > 0 && firstLine === firstLine.toUpperCase() && /[A-Z]/.test(firstLine)
      if (isUpperCase && firstLine.length < 60) {
        const parts = text.split('\n').map(p => p.trim()).filter(Boolean)
        if (parts.length > 1) {
          return '\n\n{r}' + parts[0] + '{/r}\n{r}' + parts.slice(1).join(' ') + '{/r}\n'
        }
        return '\n\n{r}' + firstLine + '{/r}\n'
      }
      if (text.length > 20 && /prayer|office|invitatory|night|evening|morning/i.test(text)) {
        return '\n\n{r}' + text + '{/r}\n'
      }
      return '{r}' + text + '{/r} '
    }
  )

  // Process italic/em tags — cross-references
  html = html.replace(
    /<em>([\s\S]*?)<\/em>/gi,
    (_, inner) => {
      const text = inner.replace(/<[^>]*>/g, '').trim()
      if (!text) return ''
      return '{i}' + text + '{/i}'
    }
  )

  // Strip remaining HTML tags
  html = html
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#8212;/g, '\u2014')
    .replace(/&#8217;/g, '\u2019')
    .replace(/&#8220;/g, '\u201C')
    .replace(/&#8221;/g, '\u201D')
    .replace(/&#119070;/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#\d+;/g, '')
    .replace(/\t/g, ' ')
    .replace(/ {2,}/g, ' ')

  return html
}

function isSectionHeader(line) {
  const rubricMatch = line.match(/^\{r\}(.+?)\{\/r\}\s*$/)
  if (rubricMatch) {
    const text = rubricMatch[1].trim()
    const upper = text.toUpperCase()
    if (upper.length > 80) return false
    if (SECTION_KEYWORDS.some((kw) => upper === kw || upper.startsWith(kw + ' ') || upper.startsWith(kw + '\n'))) return true
    if (/^PSALM\s+\d/.test(upper) || /^CANTICLE/.test(upper)) return true
    return false
  }
  return false
}

function extractSectionLabel(line) {
  const rubricMatch = line.match(/^\{r\}(.+?)\{\/r\}\s*$/)
  if (rubricMatch) return rubricMatch[1].trim()
  return line
}

function classifySection(text) {
  const upper = text.trim().toUpperCase()
  for (const kw of SECTION_KEYWORDS) {
    if (upper.includes(kw)) {
      return { type: kw.toLowerCase().replace(/\s+/g, '-'), label: text.trim() }
    }
  }
  return { type: 'text', label: text.trim() }
}

function todayDate() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}${m}${day}`
}

// ── Main handler ──

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=1800')

  const slug = req.query.slug || req.url.split('/').pop().split('?')[0]
  const date = req.query.date || todayDate()

  if (!slug) {
    return res.status(400).json({ error: 'Missing slug' })
  }

  try {
    // Use the REST API instead of scraping — avoids Cloudflare challenges
    const data = await fetchJson(
      `https://divineoffice.org/wp-json/do/v1/prayers/?date_start=${date}`
    )

    const dayData = data[date]
    if (!dayData || !dayData.prayers) {
      return res.status(404).json({ error: 'No prayers found for date ' + date })
    }

    // Find the prayer matching the slug
    let prayer = null
    for (const p of dayData.prayers) {
      const guidMatch = (p.guid || '').match(/divineoffice\.org\/([^/?]+)/)
      if (guidMatch && guidMatch[1] === slug) {
        prayer = p
        break
      }
    }

    if (!prayer) {
      return res.status(404).json({ error: 'Prayer not found: ' + slug, date })
    }

    const name = prayer.post_title || slug
    const rawHtml = prayer.post_content || ''

    // Process the HTML content
    const allText = processHtml(rawHtml)
    const lines = allText.split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .filter((l) => !isJunkLine(l))

    // Build sections
    const sections = []
    let currentSection = null

    for (const line of lines) {
      if (isSectionHeader(line)) {
        const labelText = extractSectionLabel(line)
        const { type, label } = classifySection(labelText)
        currentSection = { type, label, text: '' }
        sections.push(currentSection)
      } else if (currentSection) {
        currentSection.text += (currentSection.text ? '\n' : '') + line
      } else {
        currentSection = { type: 'intro', label: name, text: line }
        sections.push(currentSection)
      }
    }

    const filtered = sections.filter((s) => s.text.trim().length > 0)

    res.json({ slug, name, date, sections: filtered })
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch prayer', detail: err.message })
  }
}
