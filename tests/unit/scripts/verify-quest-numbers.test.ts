import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * The tone table of the verification script.
 *
 * `lib/pinyin-tone.ts`'s TONE_MAP is the **only** source of truth for the 24
 * tone marks. `scripts/verify-quest-numbers.mjs` reads it out of the source
 * file at runtime and derives its tables from it - it must never carry a
 * hand-written copy of the marks, because such a copy can drift silently.
 *
 * The marks are written as \uXXXX escapes here on purpose: this test file
 * must not contain the literals either.
 */
const TONE_MARKS: string[] = [
  '\u0101',
  '\u00E1',
  '\u01CE',
  '\u00E0',
  '\u0113',
  '\u00E9',
  '\u011B',
  '\u00E8',
  '\u012B',
  '\u00ED',
  '\u01D0',
  '\u00EC',
  '\u014D',
  '\u00F3',
  '\u01D2',
  '\u00F2',
  '\u016B',
  '\u00FA',
  '\u01D4',
  '\u00F9',
  '\u01D6',
  '\u01D8',
  '\u01DA',
  '\u01DC',
];

const SCRIPT_PATH = 'scripts/verify-quest-numbers.mjs';

describe('verify-quest-numbers - the tone table has one source of truth', () => {
  it('carries none of the 24 tone marks', () => {
    const source = readFileSync(SCRIPT_PATH, 'utf8');
    const found = TONE_MARKS.filter((mark) => source.includes(mark));
    // The code points are printed, not the marks themselves.
    expect(
      found.map((mark) => `U+${mark.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`),
    ).toEqual([]);
  });

  it('reads the table out of lib/pinyin-tone.ts', () => {
    const source = readFileSync(SCRIPT_PATH, 'utf8');
    expect(source).toContain('lib/pinyin-tone.ts');
    expect(source).toContain('TONE_MAP');
  });
});
