export type Tone = 1 | 2 | 3 | 4 | 5;

const TONE_MAP: Record<string, Tone> = {
  'ā': 1, 'á': 2, 'ǎ': 3, 'à': 4,
  'ē': 1, 'é': 2, 'ě': 3, 'è': 4,
  'ī': 1, 'í': 2, 'ǐ': 3, 'ì': 4,
  'ō': 1, 'ó': 2, 'ǒ': 3, 'ò': 4,
  'ū': 1, 'ú': 2, 'ǔ': 3, 'ù': 4,
  'ǖ': 1, 'ǘ': 2, 'ǚ': 3, 'ǜ': 4,
};

export function toneFromPinyin(py: string): Tone {
  for (const c of py) {
    if (c in TONE_MAP) return TONE_MAP[c]!;
  }
  return 5;
}