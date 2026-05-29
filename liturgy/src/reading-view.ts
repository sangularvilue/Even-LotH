// Phone reading view — read the whole office on the phone (iBreviary-style),
// independent of the glasses. A full-screen overlay that fetches the hour and
// renders all sections as a readable, illuminated scrollable document.

import { fetchHour } from './api-client'
import { icon } from './illum-heroes'
import type { LiturgicalDay } from './types'

type ReadingOpts = {
  slug: string
  name: string
  date?: string
  day?: LiturgicalDay
  ui: { back: string; remote: string }
  onRemote: () => void
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Convert one section's marker text → readable HTML (markers come from the
// scrapers: {r} rubric, {i} italic, {ant} antiphon, {v}—{/v} response).
function bodyToHtml(text: string): string {
  return text.split('\n').map((raw) => {
    const line = raw.trim()
    if (!line) return '<div class="rv-gap"></div>'
    let h = esc(line)
      .replace(/\{v\}—\{\/v\}\s*/g, '<span class="rv-resp">℟</span> ')
      .replace(/\{ant\}(.+?)\{\/ant\}/g, '<span class="rv-ant">$1</span>')
      .replace(/\{r\}(.+?)\{\/r\}/g, '<span class="rv-rubric">$1</span>')
      .replace(/\{i\}(.+?)\{\/i\}/g, '<em>$1</em>')
      .replace(/\{\/?\w+\}/g, '')
    return `<p class="rv-line">${h}</p>`
  }).join('')
}

function sectionsToHtml(sections: { label?: string; text: string }[]): string {
  return sections.map((s) => {
    const head = s.label ? `<h3 class="rv-head">${esc(s.label)}</h3>` : ''
    return `<section class="rv-section">${head}${bodyToHtml(s.text)}</section>`
  }).join('')
}

export function showReadingView(opts: ReadingOpts): void {
  const overlay = document.createElement('div')
  overlay.className = 'rv-overlay'
  overlay.innerHTML = `
    <div class="rv">
      <div class="rv-bar">
        <button class="rv-back" id="rv-back">${icon('chevron-left', { size: 18 })} ${esc(opts.ui.back)}</button>
        <button class="rv-remote" id="rv-remote">${esc(opts.ui.remote)}</button>
      </div>
      <div class="rv-doc" id="rv-doc">
        <h1 class="rv-title">${esc(opts.name)}</h1>
        ${opts.day?.title ? `<p class="rv-day">${esc(opts.day.title)}</p>` : ''}
        <div class="rv-loading">…</div>
      </div>
    </div>`
  document.body.appendChild(overlay)

  const close = () => overlay.remove()
  overlay.querySelector('#rv-back')!.addEventListener('click', close)
  overlay.querySelector('#rv-remote')!.addEventListener('click', () => opts.onRemote())

  fetchHour(opts.slug, opts.date || '')
    .then((content) => {
      const doc = overlay.querySelector('#rv-doc')
      if (!doc) return
      const dayTitle = content.day?.title || opts.day?.title
      doc.innerHTML = `
        <h1 class="rv-title">${esc(content.name || opts.name)}</h1>
        ${dayTitle ? `<p class="rv-day">${esc(dayTitle)}</p>` : ''}
        ${sectionsToHtml(content.sections)}`
    })
    .catch((err) => {
      const doc = overlay.querySelector('#rv-doc')
      if (doc) doc.innerHTML = `<p class="rv-line rv-rubric">Could not load: ${esc(String(err.message || err))}</p>`
    })
}
