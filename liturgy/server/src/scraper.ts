import { parse as parseHTML } from 'node-html-parser'
import type { HourInfo, HourContent, PrayerSection } from './types.js'

const BASE_URL = 'https://divineoffice.org'

export async function fetchHoursIndex(date: string): Promise<HourInfo[]> {
  const url = `${BASE_URL}/?date=${date}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to fetch index: ${res.status}`)
  const html = await res.text()
  const root = parseHTML(html)

  const hours: HourInfo[] = []
  const links = root.querySelectorAll('a[href]')

  for (const link of links) {
    const href = link.getAttribute('href') ?? ''
    const text = link.textContent.trim()

    // Must be a divineoffice.org prayer page link (not the homepage)
    const slugMatch = href.match(/divineoffice\.org\/([^/?]+)/)
    if (!slugMatch) continue

    // Must have a date parameter (any date â the site uses liturgical dates internally)
    if (!href.includes('?date=') && !href.includes('&date=')) continue

    const slug = slugMatch[1]
    const name = text || slug

    if (hours.some(h => h.slug === slug)) continue

    const knownHours = [
      'invitatory', 'office of readings', 'morning prayer',
      'midmorning prayer', 'midday prayer', 'midafternoon prayer',
      'evening prayer', 'night prayer',
    ]
    const nameLower = name.toLowerCase()
    if (!knownHours.some(kh => nameLower.includes(kh))) continue

    // Rewrite the link to use the requested date
    hours.push({ slug, name: name.replace(/^[A-Z][a-z]+ \d+,\s*/, '') })
  }

  return hours
}

const SECTION_KEYWORDS = [
  'HYMN', 'PSALMODY', 'PSALM', 'CANTICLE', 'READING', 'RESPONSORY',
  'INTERCESSIONS', 'CONCLUDING PRAYER', 'DISMISSAL', 'INVITATORY',
  'ANTIPHON', 'BENEDICTUS', 'MAGNIFICAT', 'NUNC DIMITTIS',
  'TE DEUM', 'OFFICE OF READINGS', 'SECOND READING',
]

function classifySection(text: string): { type: string; label: string } {
  const clean = text.trim()
  const upper = clean.toUpperCase()
  for (const keyword of SECTION_KEYWORDS) {
    if (upper.includes(keyword)) {
      const type = keyword.toLowerCase().replace(/\s+/g, '-')
      return { type, label: clean }
    }
  }
  return { type: 'text', label: clean }
}

// ââ Rubric patterns: things not read aloud â wrap in _italics_ ââ

// Red spans contain rubrics (antiphon labels, section headers, response dashes, instructions)
// We convert them to _italic_ markers before stripping HTML.
// Section-heading rubrics get stripped later when we split into sections.

const RUBRIC_PATTERNS = [
  /^Ant\.\s*\d*/,           // Ant. 1, Ant. 2, Ant.
  /^Psalm-prayer/i,
  /^Sacred Silence.*/i,
  /^Ribbon Placement/i,
  /^Or:/i,
]

function isRubricText(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  return RUBRIC_PATTERNS.some(re => re.test(t))
}

// ââ Junk to strip completely ââ

const JUNK_LINE_PATTERNS = [
  /^https?:\/\//,                          // URLs
  /^Ribbon Placement/i,                    // Ribbon placement header
  /^Liturgy of the Hours Vol/i,            // Volume reference
  /^Christian Prayer:/i,                   // Book reference
  /^Ordinary:\s*\d/i,                      // Page numbers
  /^Proper of Seasons:\s*\d/i,
  /^Psalter:.*/i,
  /^Sacred Silence\s*\(indicated/i,        // Sacred silence instruction paragraph
  /^â\s*a moment to reflect/i,
  // Credits/attribution lines
  /^"[^"]*"\s*by\s/i,                     // "Title" by Artist
  /^Title:/i,
  /^Composer:/i,
  /^Artist:/i,
  /^Used with permission/i,
  /^Text:/i,
  /^Tune:/i,
  /^Source:/i,
  /^Copyright/i,
  /^Â©/,
  /^All rights reserved/i,
  /^Music:/i,
  /^Words:/i,
  /^Meter:/i,
  /^Reprinted with/i,
  /^OneLicense/i,
  /^License #/i,
  // Donation / footer junk
  /^Contribute now/i,
  /^If you feel called/i,
  /^Lenten offering/i,
  /^helps carry this prayer/i,
  /^Thank you for praying with us/i,
  /^â$/,
  /^to top$/i,
  // CSS rules that leak through from WordPress
  /^\.stc-/,
  /^\.wp-/,
  /^margin[-:]/,
  /^padding[-:]/,
  /^border[-:]/,
  /^text-align\s*:/,
  /^text-transform\s*:/,
  /^text-decoration\s*:/,
  /^font[-:]/,
  /^font\s*:/,
  /^color\s*:/,
  /^background[-:]/,
  /^background\s*:/,
  /^display\s*:/,
  /^position\s*:/,
  /^cursor\s*:/,
  /^width\s*:/,
  /^height\s*:/,
  /^overflow\s*:/,
  /^line-height\s*:/,
  /^letter-spacing\s*:/,
  /^box-/,
  /^float\s*:/,
  /^clear\s*:/,
  /^opacity\s*:/,
  /^z-index\s*:/,
  /^top\s*:/,
  /^left\s*:/,
  /^right\s*:/,
  /^bottom\s*:/,
  /^max-width/,
  /^min-width/,
  /^vertical-align/,
  /^white-space\s*:/,
  /^word-break/,
  /^list-style/,
  /^outline\s*:/,
  /^content\s*:/,
  /^appearance/,
  /^transition/,
  /^transform/,
  /^animation/,
  /^flex/,
  /^grid/,
  /^align-/,
  /^justify-/,
  /^gap\s*:/,
  /^order\s*:/,
  /^\}/,
  /^\{/,
  /^#[0-9a-f]{3,8}\s*[;,}]?$/i,           // Bare color codes
  /^\d+px[;,]?$/,                          // Bare pixel values
  /^none\s*;?$/,
  /^auto\s*;?$/,
  /^inherit\s*;?$/,
  /^!important/,
  /^@media/,
  /^@import/,
  /^-webkit-/,
  /^-moz-/,
]

function isJunkLine(line: string): boolean {
  const t = line.trim()
  if (!t) return false
  if (JUNK_LINE_PATTERNS.some(re => re.test(t))) return true
  // Generic CSS property detection: "word-word: value;" pattern
  if (/^[a-z][-a-z]*\s*:\s*.+[;,]?\s*$/i.test(t) && t.length < 120 && !t.includes('â')) return true
  // Credit/attribution block: contains bullet-separated metadata fields
  if (/Title:.*Composer:/i.test(t) || /Artist:.*Used with/i.test(t)) return true
  if (/â¢\s*Title:/i.test(t)) return true
  // Lines that are entirely a "quoted title" by Someone
  if (/^"[^"]+"\s+by\s+.+/i.test(t)) return true
  return false
}

// ââ Main content extraction ââ

export async function fetchHourContent(slug: string, date: string): Promise<HourContent> {
  const url = `${BASE_URL}/${slug}/?date=${date}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to fetch hour ${slug}: ${res.status}`)
  const html = await res.text()
  const root = parseHTML(html)

  const h1 = root.querySelector('h1')
  const name = h1?.textContent?.trim() ?? slug

  const content =
    root.querySelector('div.entry.mb-40') ??
    root.querySelector('.entry-content') ??
    root.querySelector('article') ??
    root.querySelector('main') ??
    root

  // Step 1: Mark red-span rubrics with _italic_ before stripping HTML
  let rawHtml = content.innerHTML

  // Replace red spans with _italic_ markers for rubric text
  // Pattern: <span style="color: #ff0000;">TEXT</span>
  rawHtml = rawHtml.replace(
    /<span[^>]*color:\s*#ff0000[^>]*>([\s\S]*?)<\/span>/gi,
    (_match, inner) => {
      const text = inner.replace(/<[^>]*>/g, '').trim()
      if (!text) return ''
      // Section headings â leave as-is (will become section labels)
      if (SECTION_KEYWORDS.some(kw => text.toUpperCase() === kw || text.toUpperCase().startsWith(kw + ' '))) {
        return text
      }
      // Em-dash response markers
      if (text === 'â' || text === '\u2014' || text === '&#8212;') return 'â '
      // All other red text (rubrics, instructions) â keep plain
      return text
    }
  )

  // Step 2: Convert HTML structure to line breaks
  rawHtml = rawHtml
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')

  // Step 3: Strip remaining HTML tags, decode entities
  const textRoot = parseHTML(rawHtml)
  let allText = textRoot.textContent
    .replace(/\t/g, ' ')
    .replace(/ {2,}/g, ' ')

  // Step 4: Clean up lines
  const lines = allText.split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .filter(line => !isJunkLine(line))

  allText = lines.join('\n')

  // Step 5: Split into sections and clean each
  const sections = splitTextIntoSections(allText, name)

  // Step 6: Post-process sections â strip remaining junk from intro, clean dismissal
  for (const section of sections) {
    section.text = cleanSectionText(section.text, section.type)
  }

  // Remove empty sections
  const filtered = sections.filter(s => s.text.trim().length > 0)

  return { slug, name, date, sections: filtered }
}

function cleanSectionText(text: string, type: string): string {
  let lines = text.split('\n')

  // Strip junk lines that slipped through
  lines = lines.filter(line => !isJunkLine(line))

  // Strip leftover "Sacred Silence" multi-line instruction
  lines = lines.filter(line => {
    const t = line.trim()
    if (/sacred silence/i.test(t) && /indicated by a bell/i.test(t)) return false
    if (/a moment to reflect and receive/i.test(t)) return false
    if (/full resonance of the voice/i.test(t)) return false
    if (/unite our personal prayer/i.test(t)) return false
    if (/word of God and public voice/i.test(t)) return false
    // Credit/attribution fragments
    if (/Composer:/i.test(t) && t.length < 150) return false
    if (/Used with permission/i.test(t)) return false
    if (/Kirigin-Voss/i.test(t) && /Title/i.test(t)) return false
    // Donation / footer
    if (/feel called.*offering/i.test(t)) return false
    if (/carry this prayer.*hearts/i.test(t)) return false
    if (/contribute now/i.test(t)) return false
    if (/thank you for praying/i.test(t)) return false
    if (/your.*offering helps/i.test(t)) return false
    if (t === 'â' || /^to top$/i.test(t)) return false
    return true
  })

  // For dismissal: strip everything after "Amen." (CSS junk)
  if (type === 'dismissal') {
    const amenIdx = lines.findIndex(l => l.trim() === 'â Amen.' || l.trim() === '_â_ Amen.')
    if (amenIdx >= 0) {
      lines = lines.slice(0, amenIdx + 1)
    }
  }

  // For intro: strip everything before the actual prayer opening
  if (type === 'intro') {
    const openingIdx = lines.findIndex(l =>
      l.includes('God, come to my assistance') ||
      l.includes('Lord, open my lips') ||
      l.includes('O God, come to my aid')
    )
    if (openingIdx > 0) {
      lines = lines.slice(openingIdx)
    }
  }

  return lines.join('\n').trim()
}

function isSectionLine(line: string): boolean {
  const clean = line.trim()
  const upper = clean.toUpperCase()
  if (upper.length > 80) return false
  return SECTION_KEYWORDS.some(kw => upper === kw || upper.startsWith(kw + ' ') || upper.startsWith(kw + '\n'))
}

function splitTextIntoSections(text: string, hourName: string): PrayerSection[] {
  const sections: PrayerSection[] = []
  const lines = text.split('\n')
  let currentSection: PrayerSection | null = null

  for (const line of lines) {
    if (isSectionLine(line)) {
      const { type, label } = classifySection(line)
      currentSection = { type, label, text: '' }
      sections.push(currentSection)
    } else if (currentSection) {
      currentSection.text += (currentSection.text ? '\n' : '') + line
    } else {
      if (!currentSection) {
        currentSection = { type: 'intro', label: hourName, text: line }
        sections.push(currentSection)
      }
    }
  }

  if (sections.length <= 1 && sections[0]?.text.length > 2000) {
    return fallbackSplit(sections[0].text, hourName)
  }

  return sections
}

function fallbackSplit(text: string, hourName: string): PrayerSection[] {
  const sections: PrayerSection[] = []
  let current: PrayerSection = { type: 'intro', label: hourName, text: '' }
  sections.push(current)

  const lines = text.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    const matchedKeyword = SECTION_KEYWORDS.find(kw => {
      const idx = trimmed.indexOf(kw)
      return idx >= 0 && idx < 5
    })

    if (matchedKeyword && trimmed.length < 80) {
      const { type, label } = classifySection(trimmed)
      current = { type, label, text: '' }
      sections.push(current)
    } else {
      current.text += (current.text ? '\n' : '') + line
    }
  }

  return sections
}
