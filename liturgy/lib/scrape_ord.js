// Convert the Ordinariate office HTML (rendered by ord_engine.js from dwdo.uk's
// own engine) into our section/marker contract — the same { slug, name, date,
// url, sections:[{type,label,text}] } shape as lib/scrape_it.js, using the
// {r}/{i} markers liturgy-controller.ts already renders to glasses.
//
// We parse with jsdom (already a dependency) rather than regex: the source
// markup is nested (tab panes, dialogue tables, psalm verse spans) and a DOM
// walk is far more robust.
//
// Markup vocabulary (from dwdo.uk/js/officeFunctions.js):
//   h1                    office title (Mattins / Evensong)
//   h2/h3/h4.caption      section / sub headings
//   p.speaker             "Officiant" / "People" / "All" / "Priest" labels
//   p.psalm               psalm/canticle verse lines (span.pNumber, '&nbsp;:' splits)
//   p.rubric*             rubrics
//   span.ref              scripture references
//   table td.speaker+td   versicle/response dialogue
//   .tab-pane(.active)    English/Latin or Priest/Lay alternatives (keep active)

// jsdom 29 is ESM-only — dynamic import() avoids the Vercel bundler turning a
// static import into a require() (ERR_REQUIRE_ESM).
let _JSDOM = null
async function getJSDOM() {
  if (!_JSDOM) ({ JSDOM: _JSDOM } = await import('jsdom'))
  return _JSDOM
}

function clean(s) {
  return (s || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim()
}

// A response speaker => collapse to "R/ "; an addressing speaker => keep label.
function speakerPrefix(label) {
  const l = clean(label).toLowerCase().replace(/[:.]/g, '')
  if (l === 'people' || l === 'all') return 'R/ '
  if (l === 'officiant' || l === 'priest' || l === 'minister') return 'V/ '
  return clean(label) + ' '
}

// One psalm verse <p> -> one line. Keep the Anglican mid-verse pointing (' : ')
// rather than forcing a line break; the glasses wrap long lines anyway.
function psalmText(p) {
  const tmp = p.ownerDocument.createElement('div')
  tmp.innerHTML = p.innerHTML.replace(
    /<span[^>]*class=['"]?pNumber['"]?[^>]*>([\s\S]*?)<\/span>/gi, '$1 ',
  )
  return clean(tmp.textContent)
}

// Inline conversion of a generic <p>: span.ref -> (ref); drop other tags.
function paraText(el) {
  let html = el.innerHTML.replace(
    /<span[^>]*class=['"]?ref['"]?[^>]*>([\s\S]*?)<\/span>/gi,
    (_, inner) => ` (${clean(inner).replace(/^[()]+|[()]+$/g, '')})`,
  ).replace(/<br\s*\/?>/gi, '\n')
  const tmp = el.ownerDocument.createElement('div')
  tmp.innerHTML = html
  return clean(tmp.textContent)
}

function tableDialogue(table) {
  const lines = []
  for (const tr of table.querySelectorAll('tr')) {
    const cells = tr.querySelectorAll('td')
    if (cells.length >= 2) {
      const who = cells[0].textContent
      const said = paraText(cells[1])
      if (said) lines.push(speakerPrefix(who) + said)
    } else if (cells.length === 1) {
      const t = paraText(cells[0])
      if (t) lines.push(t)
    }
  }
  return lines.join('\n')
}

// Walk the office container and emit sections.
export async function parseOrdinariate(html, { slug, date, name, url = '' }) {
  const JSDOM = await getJSDOM()
  const dom = new JSDOM(`<!DOCTYPE html><body><div id="root">${html}</div></body>`)
  const doc = dom.window.document
  const root = doc.getElementById('root')

  // Collapse tab groups: keep the active pane, drop the rest + the tab nav.
  for (const group of root.querySelectorAll('.tab-content, .container--tabs')) {
    const active = group.querySelector('.tab-pane.active') || group.querySelector('.tab-pane')
    group.querySelectorAll('.tab-pane').forEach((p) => { if (p !== active) p.remove() })
  }
  root.querySelectorAll('.nav, ul.nav, .tab-nav, button').forEach((n) => n.remove())

  const sections = []
  let current = { type: 'intro', label: '', text: '' }
  const push = () => { if (current && current.text.trim()) sections.push(current) }
  const addLine = (line) => { if (line && line.trim()) current.text += (current.text ? '\n' : '') + line.trim() }
  let officeName = name

  // Depth-first over meaningful elements in document order.
  const walk = (node) => {
    for (const el of node.children) {
      const tag = el.tagName.toLowerCase()
      const cls = el.className || ''
      if (tag === 'h1') { officeName = clean(el.textContent) || officeName; continue }
      if (tag === 'h2' || tag === 'h3') {
        push()
        current = { type: 'section', label: clean(el.textContent), text: '' }
        continue
      }
      if (tag === 'h4') { addLine('{r}' + clean(el.textContent) + '{/r}'); continue }
      if (tag === 'table') { addLine(tableDialogue(el)); continue }
      if (tag === 'p') {
        if (/\bspeaker\b/.test(cls)) { addLine('{r}' + clean(el.textContent) + '{/r}'); continue }
        if (/\brubric\b/.test(cls)) { addLine('{r}' + paraText(el) + '{/r}'); continue }
        if (/\bpsalm\b/.test(cls)) { addLine(psalmText(el)); continue }
        addLine(paraText(el)); continue
      }
      if (tag === 'div' || tag === 'section') { walk(el); continue }
      // fallback: any other element with text
      const t = clean(el.textContent)
      if (t) addLine(t)
    }
  }
  walk(root)
  push()

  return { slug, name: officeName || name, date, url, sections }
}

// DW:DO links its lessons out to copyrighted RSV-2CE rather than embedding
// text, so the parsed lesson sections hold only the "Here beginneth..." intro.
// Fill them with public-domain KJV text fetched per citation. `fetchFn` is
// lib/bible_kjv.js's fetchKjvText (passed in to keep this module network-free).
export async function enrichLessons(sections, readings, fetchFn) {
  const targets = [['first lesson', 0], ['second lesson', 1]]
  for (const s of sections) {
    const label = (s.label || '').toLowerCase()
    for (const [needle, idx] of targets) {
      if (!label.includes(needle)) continue
      const ref = readings && readings[idx]
      if (!ref) break
      const passage = await fetchFn(ref)        // null for [O] specials (already embedded) or failures
      if (passage && passage.text) {
        s.text += (s.text ? '\n' : '') + passage.text + '\n{i}Authorized Version{/i}'
      }
      break
    }
  }
  return sections
}
