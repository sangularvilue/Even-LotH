import https from 'https'

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchUrl(new URL(res.headers.location, url).href).then(resolve, reject)
        res.resume()
        return
      }
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve(Buffer.concat(chunks).toString()))
      res.on('error', reject)
    }).on('error', reject)
  })
}

// ── Junk detection ──

const JUNK_PATTERNS = [
  /^https?:\/\//,
  /^Ribbon Placement/i, /^\{r\}Ribbon Placement/i,
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
]

function isJunkLine(line) {
  const t = line.trim()
  if (!t) return false
  if (JUNK_PATTERNS.some((re) => re.test(t))) return true
  if (/^[a-z][-a-z]*\s*:\s*.+[;,]?\s*$/i.test(t) && t.length < 120 && !t.includes('\u2014')) return true
  return false
}

// ── HTML Processing ──
// Instead of stripping all HTML, we convert semantic HTML into markers
// that we preserve in the output.
//
// Conventions in the output:
//   {r}...{/r}  = rubric (red text) — not said aloud: section headings, labels
//   {v}...{/v}  = versicle/response marker (the — that starts a response)
//   {i}...{/i}  = instruction (italic cross-references, psalm subtitles)
//   {ant}...{/ant} = antiphon
//   {title}...{/title} = psalm/canticle title (centered red text)

function processHtml(rawHtml) {
  let html = rawHtml

  // Remove hymn credit tables
  html = html.replace(/<div class="table-container">[\s\S]*?<\/div>/gi, '')

  // Remove audio players
  html = html.replace(/<div class="powerpress_player">[\s\S]*?<\/div>/gi, '')

  // Convert block-level tags to newlines FIRST so markers end up on own lines
  html = html.replace(/<\/p>/gi, '\n\n')
  html = html.replace(/<p[^>]*>/gi, '\n')
  html = html.replace(/<br\s*\/?>/gi, '\n')
  html = html.replace(/<\/div>/gi, '\n')
  html = html.replace(/<\/h[1-6]>/gi, '\n\n')
  html = html.replace(/<h[1-6][^>]*>/gi, '\n')
  html = html.replace(/<\/li>/gi, '\n')
  html = html.replace(/<\/tr>/gi, '\n')

  // Process red spans — these are rubrics
  html = html.replace(
    /<span[^>]*color:\s*#ff0000[^>]*>([\s\S]*?)<\/span>/gi,
    (_, inner) => {
      let text = inner.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '').trim()
      text = text.replace(/&#8212;/g, '\u2014').replace(/&#8217;/g, '\u2019')
      if (!text) return ''
      // Em-dash response marker
      if (text === '\u2014') return '\n{v}\u2014{/v} '
      // Antiphon label
      if (/^Ant\.?\s*\d*/i.test(text)) return '\n{ant}' + text + '{/ant} '
      // Psalm-prayer label
      if (/^Psalm-prayer/i.test(text)) return '\n{r}[Psalm-prayer]{/r}\n'
      // Section headings (all-caps or known keywords)
      const firstLine = text.split('\n')[0].trim()
      const isUpperCase = firstLine.length > 0 && firstLine === firstLine.toUpperCase() && /[A-Z]/.test(firstLine)
      if (isUpperCase && firstLine.length < 60) {
        // If multi-line (e.g. "Psalm 51\nO God, have mercy"), split: heading + subtitle
        const parts = text.split('\n').map(p => p.trim()).filter(Boolean)
        if (parts.length > 1) {
          return '\n\n{r}' + parts[0] + '{/r}\n{r}' + parts.slice(1).join(' ') + '{/r}\n'
        }
        return '\n\n{r}' + firstLine + '{/r}\n'
      }
      // Title-like red text (e.g. "Morning Prayer for Friday...")
      if (text.length > 20 && /prayer|office|invitatory|night|evening|morning/i.test(text)) {
        return '\n\n{r}' + text + '{/r}\n'
      }
      // Other red text = rubric/instruction
      return '{r}' + text + '{/r} '
    }
  )

  // Process italic/em tags — these are cross-references and subtitles
  html = html.replace(
    /<em>([\s\S]*?)<\/em>/gi,
    (_, inner) => {
      const text = inner.replace(/<[^>]*>/g, '').trim()
      if (!text) return ''
      return '{i}' + text + '{/i}'
    }
  )

  // Process centered text (psalm/canticle titles)
  html = html.replace(
    /<p[^>]*text-align:\s*center[^>]*>([\s\S]*?)<\/p>/gi,
    (_, inner) => {
      // This inner HTML may contain already-processed {r} markers
      const text = inner
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]*>/g, '')
        .trim()
      return '\n{title}' + text + '{/title}\n'
    }
  )

  // Strip remaining HTML tags (block-level already converted above)
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
    .replace(/&#119070;/g, '') // music note symbol
    .replace(/&nbsp;/g, ' ')
    .replace(/&#\d+;/g, '')
    .replace(/\t/g, ' ')
    .replace(/ {2,}/g, ' ')

  return html
}

// ── Section classification ──

const SECTION_KEYWORDS = [
  'HYMN', 'PSALMODY', 'PSALM', 'CANTICLE', 'READING', 'RESPONSORY',
  'INTERCESSIONS', 'CONCLUDING PRAYER', 'DISMISSAL', 'INVITATORY',
  'ANTIPHON', 'BENEDICTUS', 'MAGNIFICAT', 'NUNC DIMITTIS',
  'TE DEUM', 'OFFICE OF READINGS', 'SECOND READING',
]

function isSectionHeader(line) {
  // Check for {r}KEYWORD{/r} pattern (line may have only this)
  const rubricMatch = line.match(/^\{r\}(.+?)\{\/r\}\s*$/)
  if (rubricMatch) {
    const text = rubricMatch[1].trim()
    const upper = text.toUpperCase()
    if (upper.length > 80) return false
    if (SECTION_KEYWORDS.some((kw) => upper === kw || upper.startsWith(kw + ' ') || upper.startsWith(kw + '\n'))) return true
    // Also match "Psalm 51" or "Canticle – ..." as section headers
    if (/^PSALM\s+\d/.test(upper) || /^CANTICLE/.test(upper)) return true
    return false
  }
  // Also check for bare psalm/canticle titles from {title} blocks
  const titleMatch = line.match(/^\{title\}(.+?)\{\/title\}$/)
  if (titleMatch) {
    const upper = titleMatch[1].trim().toUpperCase()
    return SECTION_KEYWORDS.some((kw) => upper.startsWith(kw))
  }
  return false
}

function extractSectionLabel(line) {
  const rubricMatch = line.match(/^\{r\}(.+?)\{\/r\}\s*$/)
  if (rubricMatch) return rubricMatch[1].trim()
  const titleMatch = line.match(/^\{title\}(.+?)\{\/title\}$/)
  if (titleMatch) return titleMatch[1].trim()
  return line
}

function classifySection(rubricText) {
  const upper = rubricText.trim().toUpperCase()
  for (const kw of SECTION_KEYWORDS) {
    if (upper.includes(kw)) {
      return { type: kw.toLowerCase().replace(/\s+/g, '-'), label: rubricText.trim() }
    }
  }
  return { type: 'text', label: rubricText.trim() }
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
    const html = await fetchUrl(`https://divineoffice.org/${slug}/?date=${date}`)

    const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)
    const name = h1Match ? h1Match[1].replace(/<[^>]*>/g, '').trim() : slug

    // Extract main content
    let rawHtml = html
    const startMarkers = ['<div class="entry mb-40">', '<div class="entry-content">', '<article']
    for (const marker of startMarkers) {
      const idx = html.indexOf(marker)
      if (idx >= 0) {
        rawHtml = html.slice(idx)
        break
      }
    }

    // Cut at footer
    const uarrIdx = rawHtml.indexOf('&uarr;')
    if (uarrIdx > 0) {
      rawHtml = rawHtml.slice(0, uarrIdx)
    } else {
      const endMarkers = ['<footer', '<div id="comments"', '<div class="sidebar"', '<div id="sidebar"', '<!-- .entry']
      for (const marker of endMarkers) {
        const idx = rawHtml.indexOf(marker)
        if (idx > 0) {
          rawHtml = rawHtml.slice(0, idx)
          break
        }
      }
    }

    // Process HTML preserving semantic markers
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
        // Content before first section header = intro
        currentSection = { type: 'intro', label: name, text: line }
        sections.push(currentSection)
      }
    }

    const filtered = sections.filter((s) => s.text.trim().length > 0)

    res.json({ slug, name, date, sections: filtered })
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch hour content', detail: err.message })
  }
}
