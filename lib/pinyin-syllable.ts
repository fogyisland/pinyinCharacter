/**
 * Pinyin syllable parsing for the chain game.
 * Handles two tone formats: 'dēng' (diacritic) and 'deng1' (numeric).
 *
 * expandLastLetter is now strict identity — no i/u/ü wildcard bridging.
 * The previous wildcard ('你 → 衣') was dropped by user request 2026-07-04.
 */

export function getLastLetter(pinyin: string): string {
  const stripped = pinyin.replace(/[1-5]$/, '');
  const ascii = stripped.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  if (!ascii) return '';
  // ascii is non-empty here (guarded above), so index access is defined.
  return ascii[ascii.length - 1];
}

export function expandLastLetter(letter: string): string[] {
  return [letter];
}
