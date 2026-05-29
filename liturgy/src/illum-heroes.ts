// Season ornaments & icons for the Illumination UI — vanilla functions that
// return SVG/HTML strings (the app renders via template strings + innerHTML).
// Ported from the design handoff's illum-heroes.jsx / shared.jsx.

import { DOVE_SVG, TOMB_SVG } from './illum-art'

// ── small UI icons (stroke-based) ──
type IconOpts = { size?: number; stroke?: string; sw?: number }
export function icon(name: string, { size = 18, stroke = 'currentColor', sw = 1.6 }: IconOpts = {}): string {
  const open = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">`
  const paths: Record<string, string> = {
    'chevron-left': '<path d="M15 5l-7 7 7 7"/>',
    'chevron-right': '<path d="M9 5l7 7-7 7"/>',
    'glasses': '<circle cx="6.2" cy="13" r="3.4"/><circle cx="17.8" cy="13" r="3.4"/><path d="M9.6 12.6h4.8M3 11.2 4.6 8.6M21 11.2 19.4 8.6"/>',
    'check': '<path d="M5 12.5 10 17l9-10"/>',
  }
  return open + (paths[name] || '') + '</svg>'
}

// ── manuscript fleuron divider (Ordinary Time motif) ──
export function fleuron(color = '#9c3030', size = 12): string {
  return `<svg width="${size * 3}" height="${size}" viewBox="0 0 60 20" fill="none" stroke="${color}" stroke-width="1">`
    + '<path d="M2 10h16"/><path d="M58 10H42"/>'
    + `<path d="M30 4c-3 0-5 2-5 4s2 2 2 0-2-2-4 0M30 16c3 0 5-2 5-4s-2-2-2 0 2 2 4 0" fill="${color}" stroke="none" opacity="0.85"/>`
    + `<circle cx="30" cy="10" r="2.2" fill="${color}" stroke="none"/></svg>`
}

function flame(color: string, glow: string | null, size = 16): string {
  return `<svg width="${size}" height="${size * 1.3}" viewBox="-10 -20 20 24">`
    + `<path d="M0,2 C7,-4 5,-12 0,-18 C-1,-12 -8,-9 -5,-2 A5,5.5 0 0 0 5,-2 C6,-6 3,-8 2,-11 C5,-9 7,-5 5,2 Z" fill="${color}"/>`
    + (glow ? `<path d="M0,1 C3,-3 2,-8 0,-12 C-1,-8 -3,-6 -2,-2 A2.6,3 0 0 0 2,-2 Z" fill="${glow}"/>` : '')
    + '</svg>'
}

// ── Advent wreath: four candles (violet · violet · rose · violet); N lit ──
export function adventCandles(week: number, c: { band: string; rose: string; gold: string }): string {
  const cols = [c.band, c.band, c.rose, c.band]
  const candles = cols.map((col, i) => {
    const lit = i < week
    return `<div class="ilp-candle${lit ? '' : ' unlit'}">`
      + `<span class="flame"${lit ? ` style="background:${c.gold}"` : ''}></span>`
      + `<span class="stick" style="background:${col}"></span></div>`
  }).join('')
  return `<div class="ilp-wreath">${candles}</div>`
}

function bow(x: number, y: number, s = 1, tails = false): string {
  const RED = '#b32820', DK = '#86170f'
  return `<g transform="translate(${x},${y}) scale(${s})">`
    + (tails ? `<g fill="${RED}" stroke="${DK}" stroke-width="0.6"><path d="M-5,2 L-16,34 L-9,30 L-7,38 L-1,6 Z"/><path d="M5,2 L16,34 L9,30 L7,38 L1,6 Z"/></g>` : '')
    + `<path d="M0,0 L-30,-14 Q-37,0 -30,14 Z" fill="${RED}" stroke="${DK}" stroke-width="0.8"/>`
    + `<path d="M0,0 L30,-14 Q37,0 30,14 Z" fill="${RED}" stroke="${DK}" stroke-width="0.8"/>`
    + `<path d="M0,0 L-30,-14 Q-22,-6 -12,-2 Z" fill="${DK}" opacity="0.45"/>`
    + `<path d="M0,0 L30,-14 Q22,-6 12,-2 Z" fill="${DK}" opacity="0.45"/>`
    + `<ellipse cx="0" cy="1" rx="7" ry="8.5" fill="${RED}" stroke="${DK}" stroke-width="0.8"/></g>`
}

export function christmasWreath(dark: boolean): string {
  const g1 = dark ? '#1f5a38' : '#1c5132'
  const g2 = dark ? '#3e9460' : '#357f4e'
  const berry = '#c0271d'
  let sprigs = ''
  for (let i = 0; i < 52; i++) {
    const a = (i / 52) * Math.PI * 2
    const ir = 50 + (i % 2 ? 6 : 0), or = 82 + (i % 3 ? 0 : 5), sp = 0.16
    sprigs += `<line x1="${100 + Math.cos(a) * ir}" y1="${100 + Math.sin(a) * ir}" x2="${100 + Math.cos(a + sp) * or}" y2="${100 + Math.sin(a + sp) * or}" stroke="${i % 2 ? g2 : g1}" stroke-width="${i % 3 ? 7 : 9}" stroke-linecap="round"/>`
  }
  let berries = ''
  for (let i = 0; i < 13; i++) {
    const a = (i / 13) * Math.PI * 2 + 0.3, r = 60 + (i % 3) * 9
    berries += `<circle cx="${100 + Math.cos(a) * r}" cy="${100 + Math.sin(a) * r}" r="3.6" fill="${berry}"/>`
  }
  return `<svg width="186" height="200" viewBox="0 0 200 212" aria-label="Christmas wreath">`
    + `<circle cx="100" cy="100" r="66" fill="none" stroke="${g1}" stroke-width="26" opacity="0.85"/>`
    + sprigs + berries + bow(100, 170, 1.12, true) + bow(100, 32, 0.92) + '</svg>'
}

export function easterTomb(dark: boolean): string {
  const gold = dark ? '#cda44f' : '#a9842f', hd = dark ? '#9c7a3a' : '#7a5a26'
  return `<div class="ilp-hero-art" style="width:214px;height:214px;margin:0 auto;color:${gold};--hd:${hd}">${TOMB_SVG}</div>`
}

export function pentecostDove(dark: boolean): string {
  const gold = dark ? '#cda44f' : '#a9842f', hd = dark ? '#d4685c' : '#9c2f2f'
  const flames = [0, 1, 2, 3, 4].map((i) => flame(i % 2 ? (dark ? '#cf5a4e' : '#c0271d') : gold, null, 13)).join('')
  return `<div style="text-align:center"><div class="ilp-hero-art" style="width:180px;height:180px;margin:0 auto;color:${gold};--hd:${hd}">${DOVE_SVG}</div>`
    + `<div style="display:flex;gap:12px;justify-content:center;margin-top:2px;opacity:.9">${flames}</div></div>`
}
