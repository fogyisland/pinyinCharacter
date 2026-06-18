/**
 * Chinese pinyin has 4 tones (1-4). Neutral/轻声 is not a 5th tone — it's
 * a separate phonological category (no diacritic). The game UI exposes
 * only 1-4 as draggable tokens, so we return `null` for neutral-pinyin
 * chars and let the caller (buildRound) skip them.
 */
export type Tone = 1 | 2 | 3 | 4;

const TONE_MAP: Record<string, Tone> = {
  'ā': 1, 'á': 2, 'ǎ': 3, 'à': 4,
  'ē': 1, 'é': 2, 'ě': 3, 'è': 4,
  'ī': 1, 'í': 2, 'ǐ': 3, 'ì': 4,
  'ō': 1, 'ó': 2, 'ǒ': 3, 'ò': 4,
  'ū': 1, 'ú': 2, 'ǔ': 3, 'ù': 4,
  'ǖ': 1, 'ǘ': 2, 'ǚ': 3, 'ǜ': 4,
};

export const ALL_TONES: readonly Tone[] = [1, 2, 3, 4] as const;

export function toneFromPinyin(py: string): Tone | null {
  for (const c of py) {
    if (c in TONE_MAP) return TONE_MAP[c]!;
  }
  return null;
}
