import { setBreviaryId, getBreviaryId } from './settings'
import { BREVIARIES, localeFor, type BreviaryStatus } from './breviaries'
import { SEASON_STYLE, type SeasonId } from './liturgical-season'
import { icon } from './illum-heroes'

// Picker UI copy (kept local to avoid a circular import with main.ts STRINGS).
const UI = {
  en: { choose: 'Choose your breviary', sub: 'This becomes your default', back: 'Settings', def: 'default', beta: 'beta', soon: 'coming soon' },
  it: { choose: 'Scegli il breviario', sub: 'Diventa il predefinito', back: 'Impostazioni', def: 'predefinito', beta: 'beta', soon: 'prossimamente' },
  ord: { choose: 'Choose your office book', sub: 'This becomes your default', back: 'Settings', def: 'default', beta: 'beta', soon: 'coming soon' },
}

function hexA(hex: string, a: number): string {
  const h = hex.replace('#', '')
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`
}

// Renders a full-screen breviary picker, themed to match the current season/
// theme (read from <html> data-attrs set by main.ts). Resolves with the chosen
// breviary id, persisting it. Illuminated normally; brutalist during Lent.
export function showBreviaryPicker(): Promise<string> {
  return new Promise((resolve) => {
    const ds = document.documentElement.dataset
    const season = (ds.season as SeasonId) || 'ordinary'
    const dark = ds.theme === 'dark'
    const lent = season === 'lent'
    const S = SEASON_STYLE[season] || SEASON_STYLE.ordinary
    const currentId = getBreviaryId()
    const L = UI[localeFor(currentId)]

    const gold = dark ? '#cda44f' : '#a9842f'
    const paper = lent ? (dark ? '#0c0c0a' : '#f3f2ec') : (dark ? '#14130d' : '#f2e8cf')
    const ink = lent ? (dark ? '#eae9e1' : '#121210') : (dark ? '#e9ddbe' : '#241d14')
    const panel = dark ? '#1d1a12' : '#f7efd9'
    const muted = lent ? (dark ? '#8c8a80' : '#5a584f') : (dark ? '#a89668' : '#8a7a52')
    const link = dark ? '#82a0ff' : '#16389e'
    const accent = lent ? ink : (dark ? gold : S.bandDeep)

    const vars: Record<string, string> = {
      '--bpPaper': paper, '--bpInk': ink, '--bpMuted': muted, '--bpAccent': lent ? link : accent,
      '--bpBorder': lent ? ink : hexA(gold, 0.45),
      '--bpCard': lent ? 'transparent' : panel,
      '--bpBadge': lent ? ink : S.band, '--bpBadgeFg': lent ? paper : '#f6eed6',
      '--bpRadius': lent ? '0px' : '10px',
    }
    const styleStr = Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(';')

    const overlay = document.createElement('div')
    overlay.style.cssText = 'position:fixed;inset:0;z-index:50;overflow:auto;'
    overlay.innerHTML = `
      <div class="bp${lent ? ' lent' : ''}" style="${styleStr}">
        <div class="bp-back" id="bp-back">${icon('chevron-left', { size: 18, stroke: 'var(--bpAccent)' })} ${L.back}</div>
        <div class="bp-h">${lent ? L.choose.toUpperCase() : L.choose}</div>
        <div class="bp-sub">${lent ? L.sub.toUpperCase() : L.sub}</div>
        <div class="bp-list">
          ${BREVIARIES.map((b) => {
            const cur = b.id === currentId
            const off = b.status === 'coming-soon'
            return `<div class="bp-card${cur ? ' cur' : ''}${off ? ' off' : ''}" data-id="${b.id}" data-off="${off ? '1' : '0'}">
              <div class="bp-badge">${b.badge}</div>
              <div style="flex:1;min-width:0">
                <div class="bp-name">${b.name} ${statusTag(b.status, accent, muted, L)}</div>
                <div class="bp-pub">${b.publisher}</div>
                ${b.note ? `<div class="bp-note">${b.note}</div>` : ''}
              </div>
              ${cur ? `<span class="bp-cur-tag">✓ ${L.def}</span>` : ''}
            </div>`
          }).join('')}
        </div>
      </div>`
    document.body.appendChild(overlay)

    const close = (id: string | null) => { overlay.remove(); if (id) { setBreviaryId(id); resolve(id) } else resolve(currentId) }
    overlay.addEventListener('click', (e) => {
      const target = e.target as HTMLElement
      if (target.closest('#bp-back')) { close(null); return }
      const card = target.closest<HTMLElement>('.bp-card')
      if (!card || card.dataset.off === '1') return
      close(card.dataset.id || null)
    })
  })
}

function statusTag(status: BreviaryStatus, accent: string, muted: string, L: { beta: string; soon: string }): string {
  if (status === 'coming-soon') return `<span class="bp-tag" style="background:${hexA(muted, 0.15)};color:${muted}">${L.soon}</span>`
  if (status === 'beta') return `<span class="bp-tag" style="background:${hexA(accent, 0.15)};color:${accent}">${L.beta}</span>`
  return ''
}
