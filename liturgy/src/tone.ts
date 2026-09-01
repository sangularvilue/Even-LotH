/**
 * Brightness tones for the G2 text containers.
 *
 * SDK 0.0.14 added `textColor` (0–4) to TextContainerProperty and
 * TextContainerUpgrade. Per the SDK typings: omitting the field on create or
 * rebuild uses the device default of 4, so **4 is the brightest level and 0 the
 * dimmest**.
 *
 * A printed breviary distinguishes what you *say* (black) from what you *do*
 * (red rubrics). The G2 has one colour, so brightness carries that distinction:
 * spoken text sits at full brightness and rubrics recede.
 *
 * `textColor` applies to a whole container, not to runs inside one — so the
 * reading page is built from one container per line (see LINE_SLOTS in
 * liturgy-controller.ts) and each line carries its own tone.
 */

export type Tone =
  | 'body'      // spoken text — psalm verses, readings, prayers
  | 'emphasis'  // antiphons: spoken, and the hinge of the psalmody
  | 'response'  // R/ markers and versicle responses
  | 'heading'   // section headings and psalm/canticle titles
  | 'rubric'    // instructions, not said aloud
  | 'faint'     // cross-references, page furniture, progress bar

/**
 * If a firmware revision ever inverts the scale (0 = brightest), flip this one
 * flag rather than re-tuning every tone.
 */
const INVERTED = false

// Kept deliberately shy of 0: a rubric must still be legible in daylight, and
// the bottom of the ramp is very dark against a bright background.
const LEVELS: Record<Tone, number> = {
  body: 4,
  emphasis: 4,
  response: 3,
  heading: 3,
  rubric: 2,
  faint: 1,
}

export function toneLevel(tone: Tone): number {
  const level = LEVELS[tone] ?? 4
  return INVERTED ? 4 - level : level
}

/**
 * Plain-text fallback for hosts that predate `textColor` (Even App < 2.2.9) or
 * for users who turn tones off. Restores the ASCII scaffolding that carried the
 * hierarchy before brightness existed.
 */
export function toneScaffold(text: string, tone: Tone): string {
  if (!text.trim()) return text
  switch (tone) {
    case 'heading':
      return /^[A-Z0-9 ,:–—-]+$/.test(text) ? `== ${text} ==` : text
    case 'rubric':
      return `[${text}]`
    default:
      return text
  }
}
