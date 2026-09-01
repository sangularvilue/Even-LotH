import { getTextWidth, measureTextWrap } from '@evenrealities/pretext'
const W = 564
const probes = [
  ['progress bar (30 box chars)', '\u2501'.repeat(12) + '\u2500'.repeat(18)],
  ['50 x M (worst case)', 'M'.repeat(50)],
  ['50 x lowercase', 'm'.repeat(50)],
  ['50 chars typical psalm', 'Preserve me, God, I take refuge in you: I say to'],
  ['long antiphon line', 'Ant. 1  The Lord is my portion and my cup; it is you'],
  ['title', 'Psalm 16 - God is my portion, my inheritance.'],
]
for (const [label, t] of probes) {
  const w = getTextWidth(t)
  const m = measureTextWrap(t, W)
  console.log(`${w > W ? 'OVERFLOW' : 'ok      '} ${String(w).padStart(4)}px / ${W}  lines=${m.lineCount}  ${label}`)
}
// How many chars of a mid-weight sentence fit in 564px?
const s = 'the quick brown fox jumps over the lazy dog and keeps on running past the gate '
let n = 0
while (getTextWidth(s.repeat(4).slice(0, n + 1)) <= W) n++
console.log(`\nprose chars that fit in ${W}px: ${n}  (CHARS_PER_LINE is 50)`)
console.log(`caps chars that fit: ${(() => { let k = 0; while (getTextWidth('M'.repeat(k + 1)) <= W) k++; return k })()}`)
