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

const SECTION_KEYWORDS = [
  'HYMN', 'PSALMODY', 'PSALM', 'CANTICLE', 'READING', 'RESPONSORY',
  'INTERCESSIONS', 'CONCLUDING PRAYER', 'DISMISSAL', 'INVITATORY',
  'ANTIPHON', 'BENEDICTUS', 'MAGNIFICAT', 'NUNC DIMITTIS',
  'TE DEUM', 'OFFICE OF READINGS', 'SECOND READING',
]

const JUNK_PATTERNS = [
  /^https?:\/\//,
  /^Ribbon Placement/i,
  /^Liturgy of the Hours Vol/i,
  /^Christian Prayer:/i,
  /^Ordinary:\s*\d/i,
  /^Proper of Seasons:\s*\d/i,
  /^Psalter:.*/i,
  /^Sacred Silence\s*\(indicated/i,
  /^â\s*a moment to reflect/i,
  /^"[^"]*"\s*by\s/i,
  /^Title:/i, /^Composer:/i, /^Artist:/i,
  /^Used with permission/i, /^Text:/i, /^Tune:/i,
  /^Source:/i, /^Copyright/i, /^Â©/,
  /^All rights reserved/i, /^Music:/i, /^Words:/i,
  /^Meter:/i, /^Reprinted with/i, /^OneLicense/i, /^License #/i,
  /^Contribute now/i, /^If you feel called/i,
  /^Lenten offering/i, /^helps carry this prayer/i,
  /^Thank you for praying with us/i, /^â$/, /^to top$/i,
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
  /^gap\s*:/, /^order\s*:/, /^\}/, /^\{/,
  /^#[0-9a-f]{3,8}\s*[;,}]?$/i, /^\d+px[;,]?$/,
  /^none\s*;?$/, /^auto\s*;?$/, /^inherit\s*;?$/,
  /^!important/, /^@media/, /^@import/, /^-webkit-/, /^-moz-/,
]

function isJunkLine(line) {
  const t = line.trim()
  if (!t) return false
  if (JUNK_PATTERNS.some((re) => re.test(t))) return true
  if (/^[a-z][-a-z]*\s*:\s*.+[;,]?\s*$/i.test(t) && t.length < 120 && !t.includes('â')) return true
  return false
}

function isSectionLine(line) {
  const upper = line.trim().toUpperCase()
  if (upper.length > 80) return false
  return SECTION_KEYWORDS.some((kw) => upper === kw || upper.startsWith(kw + ' ') || upper.startsWith(kw + '\n'))
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

function stripHtml(html) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#8212;/g, '\u2014')
    .replace(/&#8217;/g, '\u2019')
    .replace(/&#8220;/g, '\u201C')
    .replace(/&#8221;/g, '\u201D')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#\d+;/g, '')
    .replace(/\t/g, ' ')
    .replace(/ {2,}/g, ' ')
}

function todayDate() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}${m}${day}`
}

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

    // Extract main content â use greedy match and cut at footer/sidebar markers
    let rawHtml = html
    const startMarkers = ['<div class="entry mb-40">', '<div class="entry-content">', '<article']
    for (const marker of startMarkers) {
      const idx = html.indexOf(marker)
      if (idx >= 0) {
        rawHtml = html.slice(idx)
        break
      }
    }
    // Cut at the "back to top" arrow â everything after is footer junk
    const uarrIdx = rawHtml.indexOf('&uarr;')
    if (uarrIdx > 0) {
      rawHtml = rawHtml.slice(0, uarrIdx)
    } else {
      // Fallback: cut at known end markers
      const endMarkers = ['<footer', '<div id="comments"', '<div class="sidebar"', '<div id="sidebar"', '<!-- .entry']
      for (const marker of endMarkers) {
        const idx = rawHtml.indexOf(marker)
        if (idx > 0) {
          rawHtml = rawHtml.slice(0, idx)
          break
        }
      }
    }

    let processed = rawHtml.replace(
      /<span[^>]*color:\s*#ff0000[^>]*>([\s\S]*?)<\/span>/gi,
      (_, inner) => {
        const text = inner.replace(/<[^>]*>/g, '').trim()
        if (!text) return ''
        if (text === '\u2014' || text === 'â') return 'â '
        return text
      }
    )

    const allText = stripHtml(processed)
    const lines = allText.split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .filter((l) => !isJunkLine(l))

    const sections = []
    let currentSection = null

    for (const line of lines) {
      if (isSectionLine(line)) {
        const { type, label } = classifySection(line)
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
    res.status(500).json({ error: 'Failed to fetch hour content', detail: err.message })
  }
}
