/**
 * Turning a breviary's markup into pages the G2 can render.
 *
 * Pure functions, no SDK: this is where the semantic markers the API emits
 * ({r} rubric, {v} response, {ant} antiphon, {i} cross-reference) become lines
 * tagged with a brightness tone, wrapped to a real pixel width, and cut into
 * pages of at most LINES_PER_PAGE lines.
 */

import { getTextWidth } from '@evenrealities/pretext'
import type { PrayerSection } from './types'
import type { Tone } from './tone'

/** One rendered line: its text plus the brightness tone it is spoken (or not) in. */
export type PageLine = { text: string; tone: Tone }

export function wrapToWidth(text: string, maxWidth: number): string[] {
  if (getTextWidth(text) <= maxWidth) return [text]

  const wrapped: string[] = []
  let current = ''
  for (const word of text.split(' ')) {
    const candidate = current ? `${current} ${word}` : word
    if (getTextWidth(candidate) > maxWidth && current) {
      wrapped.push(current)
      current = word
    } else {
      current = candidate
    }
  }
  if (current) wrapped.push(current)

  // A single word wider than the line — a long reference, or Latin without a
  // space to break at — still has to be cut somewhere.
  const out: string[] = []
  for (const line of wrapped) {
    if (getTextWidth(line) <= maxWidth) { out.push(line); continue }
    let rest = line
    while (rest.length > 1 && getTextWidth(rest) > maxWidth) {
      let cut = rest.length
      while (cut > 1 && getTextWidth(rest.slice(0, cut)) > maxWidth) cut--
      out.push(rest.slice(0, cut))
      rest = rest.slice(cut)
    }
    if (rest) out.push(rest)
  }

  return out.length > 0 ? out : [text]
}

// ── Junk lines to strip from intro ──
const INTRO_JUNK = [
  /general instruction/i,
  /please pray with us/i,
  /joining with us in saying/i,
  /indicated in this/i,
  /consider an examination/i,
  /best make use of our time/i,
  /\[highlight\]/i,
  /\[\.?\]$/,
  /^\[Night Prayer/i,
  /^\[Morning Prayer/i,
  /^\[Evening Prayer/i,
  /^\[Office of Readings/i,
  /^\[Midmorning Prayer/i,
  /^\[Midday Prayer/i,
  /^\[Midafternoon Prayer/i,
  /^\[Invitatory/i,
  /Ribbon Placement/i,
  /Liturgy of the Hours Vol/i,
  /Christian Prayer:/i,
  /^Ordinary:\s*\d/i,
  /^Proper of Seasons:\s*\d/i,
  /^Psalter:/i,
  /^Page \d+/i,
  /^Antiphon:\s*\d/i,
  /^Psalm:\s*\d/i,
  /^\{r\}Sacred Silence/i,
  /^Sacred Silence/i,
  /indicated by a bell/i,
  /full resonance of the voice/i,
  /unite our personal prayer/i,
]

function isIntroJunk(line: string): boolean {
  return INTRO_JUNK.some(re => re.test(line))
}

/**
 * Convert semantic markers to plain text and reformat psalm/canticle headers.
 *
 * Psalm headers become:
 *   Psalm 16 - God is my portion, my inheritance.
 *   (The Father raised up Jesus...) - Acts 2:24
 *
 * Returns { text, isNewSection } where isNewSection forces a page break.
 */
type FormattedLine = { text: string; pageBreak: boolean; tone: Tone }

function formatLines(rawLines: string[]): FormattedLine[] {
  const result: FormattedLine[] = []
  const blank = (): FormattedLine => ({ text: '', pageBreak: false, tone: 'body' })
  let i = 0

  while (i < rawLines.length) {
    let line = rawLines[i]!

    // Strip intro junk
    if (isIntroJunk(line)) { i++; continue }

    // Detect psalm/canticle/scripture title patterns:
    //   {r}Psalm 16\nsubtitle{/r}      (psalm)
    //   {r}Luke 2:29-32{/r}            (canticle scripture ref)
    //   {r}Luke 1:68 79\nsubtitle{/r}  (canticle scripture ref + subtitle)
    //   {r}Canticle – Isaiah 45{/r}    (canticle with source)
    //   Hebrews 2:9-10                 (bare reading reference)
    const TITLE_PATTERN = /^(?:Psalm|Canticle|Luke|Isaiah|Jeremiah|Daniel|Exodus|Deuteronomy|Revelation|Colossians|Philippians|Ephesians|Romans|Hebrews|1 Peter|1 Corinthians|1 Kings|1 Thessalonians|James|Joel|Nehemiah|See\s)/i
    const SCRIPTURE_REF = /^[1-3]?\s?[A-Z][a-z]+\s+\d+[:\d\s,\-a-z]*$/

    // Pattern A: complete on one line with {r}
    const titleMatchA = line.match(/^\{r\}((?:Psalm|Canticle|Luke|Isaiah|Daniel|Revelation|Colossians|Philippians|Ephesians|Romans|Hebrews|1 Peter|1 Corinthians|1 Kings|1 Thessalonians|James|Joel|Nehemiah|Jeremiah|Deuteronomy|Exodus|See\s)[^{]*)\{\/r\}$/i)
    // Pattern B: opening {r} with title, no closing (continues on next line)
    const titleMatchB = line.match(/^\{r\}((?:Psalm|Canticle|Luke|Isaiah|Daniel|Revelation|Colossians|Philippians|Ephesians|Romans|Hebrews|1 Peter|1 Corinthians|1 Kings|1 Thessalonians|James|Joel|Nehemiah|Jeremiah|Deuteronomy|Exodus|See\s)[^{]*)$/i)
    // Pattern C: bare scripture reference at start of reading (no {r} markers)
    const titleMatchC = !line.includes('{') && SCRIPTURE_REF.test(line.trim()) ? line.trim() : null

    if (titleMatchA || titleMatchB || titleMatchC) {
      let title: string
      let subtitle = ''

      if (titleMatchC) {
        // Bare scripture reference (reading)
        title = titleMatchC
      } else if (titleMatchA) {
        const parts = titleMatchA[1].trim().split('\n').map(p => p.trim()).filter(Boolean)
        title = parts[0]!
        subtitle = parts.slice(1).join(' ')
      } else {
        // Pattern B: title on this line, subtitle on next line ending with {/r}
        title = titleMatchB![1].trim()
        if (i + 1 < rawLines.length) {
          const nextLine = rawLines[i + 1]!
          const closingMatch = nextLine.match(/^(.+?)\{\/r\}$/)
          if (closingMatch) {
            subtitle = closingMatch[1].trim()
            i++
          }
        }
      }

      // Check if next line is also a red subtitle (e.g. {i}{r}The soul rejoices{/r}{/i})
      if (!subtitle && i + 1 < rawLines.length) {
        const nextLine = rawLines[i + 1]!
        // Match {r}subtitle{/r} or {i}{r}subtitle{/r}{/i} or {i}subtitle{/i}
        const subMatch = nextLine.match(/^\{[ri]\}(?:\{[ri]\})?(.+?)(?:\{\/[ri]\})?\{\/[ri]\}$/)
        if (subMatch && !/^(HYMN|PSALMODY|READING|RESPONSORY|INTERCESSIONS|CONCLUDING|DISMISSAL|CANTICLE OF|Sacred Silence)/i.test(subMatch[1])) {
          subtitle = subMatch[1].trim()
          i++
        }
      }

      let headerLine = subtitle ? `${title} - ${subtitle}` : title

      // Check if next line is a cross-reference
      let crossRef = ''
      if (i + 1 < rawLines.length) {
        const refMatch = rawLines[i + 1]!.match(/^\{i\}(.+?)\{\/i\}\s*(\([^)]+\))?\.?$/)
        if (refMatch) {
          crossRef = `(${refMatch[1]}) - ${refMatch[2] || ''}`.replace(/ - $/, '')
          i++
        }
      }

      result.push({ text: headerLine, pageBreak: true, tone: 'heading' })
      if (crossRef) result.push({ text: crossRef, pageBreak: false, tone: 'faint' })
      result.push(blank())
      i++
      continue
    }

    // Detect section headings: {r}READING{/r}, {r}HYMN{/r} etc.
    const sectionMatch = line.match(/^\{r\}([A-Z][A-Z\s\d:,\-]+)\{\/r\}$/)
    if (sectionMatch) {
      const heading = sectionMatch[1].trim()
      // READING often has a reference on the same line or next. The `== ==`
      // rails are gone — brightness marks the heading now (and toneScaffold()
      // puts them back if tones are turned off).
      result.push({ text: heading, pageBreak: true, tone: 'heading' })
      i++
      continue
    }

    // ── Tone ──
    // `textColor` applies to a whole container, so each line carries exactly one
    // tone, chosen from its dominant marker BEFORE the markers are stripped.
    const wholeRubric = /^\{r\}[^{]*\{\/r\}\.?$/.test(line)
    const wholeItalic = /^\{i\}[^{]*\{\/i\}\.?$/.test(line)
    const tone: Tone = wholeRubric
      ? (/^\{r\}[A-Z0-9 ,:;.–—-]+\{\/r\}\.?$/.test(line) ? 'heading' : 'rubric')
      : line.includes('{ant}') ? 'emphasis'
      : line.includes('{v}') ? 'response'
      : wholeItalic ? 'faint'
      : 'body'

    // Format remaining markers
    let formatted = line
      // Bracketed instructions like [Psalm-prayer]. A rubric that IS the line is
      // carried by brightness; one embedded in spoken text keeps its brackets so
      // it still reads as an aside.
      .replace(/\{r\}\[([^\]]+)\]\{\/r\}/g, wholeRubric ? '$1' : '[$1]')
      // Other rubrics
      .replace(/\{r\}(.+?)\{\/r\}/g, wholeRubric ? '$1' : '[$1]')
      // Response marker
      .replace(/\{v\}\u2014\{\/v\}\s*/g, 'R/ ')
      // Antiphon labels
      .replace(/\{ant\}(Ant\.?\s*\d*)\{\/ant\}\s*/g, '* $1 ')
      // Italic cross-references -> parens
      .replace(/\{i\}(.+?)\{\/i\}/g, '($1)')
      // Title blocks
      .replace(/\{title\}(.+?)\{\/title\}/g, '$1')
      // Clean remaining markers
      .replace(/\{\/?\w+\}/g, '')

    // Skip empty after cleanup
    if (!formatted.trim()) { i++; continue }

    // Antiphons get spacing
    const isAntiphon = formatted.startsWith('* Ant')
    // Confiteor / penitential rite get a break before
    const isPrayerStart = /^(I confess to almighty God|Lord Jesus|God, come to my assistance)/.test(formatted)

    if (isAntiphon || isPrayerStart) {
      result.push(blank())
    }

    result.push({ text: formatted, pageBreak: false, tone })

    if (isAntiphon) {
      result.push(blank())
    }

    i++
  }

  return result
}

// Returns the paginated pages — as tone-tagged lines for the glasses and as
// plain text for the companion panel — plus a parallel array of the section
// label each page belongs to (used by auto-advance to place silence at section
// ends).
export type Paginated = { pages: string[]; pageLines: PageLine[][]; sectionLabels: string[] }

export function paginateSections(
  sections: PrayerSection[],
  maxWidth: number,
  linesPerPage: number,
): Paginated {
  // Build all formatted lines with page break markers, tagged by section.
  const entries: { text: string; pageBreak: boolean; tone: Tone; section: string }[] = []

  for (const section of sections) {
    const label = section.label || ''
    // For canticle sections, the label (e.g. "CANTICLE OF SIMEON") becomes
    // part of the title header — the scripture ref in the body takes over
    const isCanticleSection = /^canticle of/i.test(label)
    if (label && !isCanticleSection) {
      entries.push({ text: '', pageBreak: false, tone: 'body', section: label })
      entries.push({ text: label, pageBreak: true, tone: 'heading', section: label })
      entries.push({ text: '', pageBreak: false, tone: 'body', section: label })
    }
    if (isCanticleSection) {
      entries.push({ text: label, pageBreak: true, tone: 'heading', section: label })
    }

    const rawLines = section.text.split('\n').map(l => l.trim()).filter(l => l.length > 0)
    for (const e of formatLines(rawLines)) entries.push({ ...e, section: label })
  }

  // Paginate — respect page breaks and LINES_PER_PAGE limit
  const pageLines: PageLine[][] = []
  const sectionLabels: string[] = []
  let currentPage: PageLine[] = []
  let pageSection = ''
  const flush = () => { pageLines.push(currentPage); sectionLabels.push(pageSection); currentPage = [] }

  for (const entry of entries) {
    if (entry.pageBreak && currentPage.some(l => l.text.trim().length > 0)) flush()
    const wrapped = entry.text === '' ? [''] : wrapToWidth(entry.text, maxWidth)
    for (const wline of wrapped) {
      if (currentPage.length >= linesPerPage && currentPage.some(l => l.text.trim().length > 0)) flush()
      if (currentPage.length === 0) pageSection = entry.section
      currentPage.push({ text: wline, tone: entry.tone })
    }
  }
  if (currentPage.some(l => l.text.trim().length > 0)) flush()

  if (pageLines.length === 0) {
    return { pages: ['(empty)'], pageLines: [[{ text: '(empty)', tone: 'faint' }]], sectionLabels: [''] }
  }
  return {
    pages: pageLines.map(lines => lines.map(l => l.text).join('\n')),
    pageLines,
    sectionLabels,
  }
}
