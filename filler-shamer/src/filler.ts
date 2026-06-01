/**
 * Filler-word detection. Operates on FINAL transcript segments only
 * (partials get rewritten, so counting them would double-count).
 */

/** Single-word fillers. Matched as whole words, case-insensitive. */
const SINGLE_WORD_FILLERS = [
  'um', 'uh', 'er', 'ah', 'hmm', 'hm', 'mm',
  'like', 'so', 'basically', 'actually', 'literally',
  'right', 'okay', 'ok', 'anyway', 'well',
];

/** Multi-word filler phrases. Matched as contiguous sequences. */
const PHRASE_FILLERS = [
  'you know', 'i mean', 'sort of', 'kind of', 'you see',
];

const SINGLE_WORD_SET = new Set(SINGLE_WORD_FILLERS);

/** True if a single token is a filler word (used for inline ticker highlighting). */
export function isFillerWord(word: string): boolean {
  return SINGLE_WORD_SET.has(word.toLowerCase().replace(/[^a-z]/g, ''));
}

export type FillerCounts = Record<string, number>;

export function emptyCounts(): FillerCounts {
  return {};
}

/**
 * Count filler occurrences in a final transcript segment.
 * Returns a delta map (only words that appeared), to be merged into a running total.
 */
export function countFillers(text: string): FillerCounts {
  const delta: FillerCounts = {};
  if (!text) return delta;

  const normalized = ` ${text.toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim()} `;

  for (const phrase of PHRASE_FILLERS) {
    const matches = normalized.split(` ${phrase} `).length - 1;
    if (matches > 0) delta[phrase] = (delta[phrase] ?? 0) + matches;
  }

  const tokens = normalized.trim().split(' ').filter(Boolean);
  for (const tok of tokens) {
    if (SINGLE_WORD_FILLERS.includes(tok)) {
      delta[tok] = (delta[tok] ?? 0) + 1;
    }
  }

  return delta;
}

export function mergeCounts(total: FillerCounts, delta: FillerCounts): void {
  for (const [word, n] of Object.entries(delta)) {
    total[word] = (total[word] ?? 0) + n;
  }
}

export function totalCount(counts: FillerCounts): number {
  return Object.values(counts).reduce((a, b) => a + b, 0);
}

/** Top-N fillers as "word×n" strings, most frequent first. */
export function topFillers(counts: FillerCounts, n: number): string[] {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([word, count]) => `${word}×${count}`);
}
