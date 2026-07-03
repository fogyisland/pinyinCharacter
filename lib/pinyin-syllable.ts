/**
 * Pinyin syllable parsing for the chain game.
 * Handles two tone formats: 'dēng' (diacritic) and 'deng1' (numeric).
 * Wildcards for i/u/ü chain endings are in expandLastLetter.
 */

export function getLastLetter(pinyin: string): string {
  const stripped = pinyin.replace(/[1-5]$/, '');
  const ascii = stripped.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  if (!ascii) return '';
  return ascii[ascii.length - 1] ?? '';
}

export function expandLastLetter(letter: string): string[] {
  if (letter === 'i') return ['i', 'y'];
  if (letter === 'u') return ['u', 'w', 'y', 'j', 'q', 'x', 'l', 'n'];
  if (letter === 'v' || letter === 'ü') return ['v', 'ü', 'y', 'j', 'q', 'x', 'l', 'n'];
  return [letter];
}
