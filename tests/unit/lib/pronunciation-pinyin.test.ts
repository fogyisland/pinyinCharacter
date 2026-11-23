// @vitest-environment node
import { describe, it, expect } from 'vitest';

/**
 * The panel needs the recognized characters' SIBYLLABLES to tell a tone
 * mistake from a wrong character: 学生 heard as 雪生 is only a tone mistake
 * if 雪's reading is known. This pins that the dictionary the site already
 * ships supplies readings for exactly that purpose.
 */

describe('pinyin for recognised characters', () => {
  it('gives a reading per character, with the tone mark', async () => {
    const { textToPinyin } = await import('@/lib/pinyin-client');
    const tokens = await textToPinyin('雪生');
    expect(tokens.map((t) => t.char)).toEqual(['雪', '生']);
    // Diacritics, not tone digits: the comparison strips marks itself.
    expect(tokens[0].readings[0]).toBe('xuě');
    expect(tokens[1].readings[0]).toBe('shēng');
  });

  it('shares the syllable with the target character, which is what makes a tone mistake visible', async () => {
    const { textToPinyin } = await import('@/lib/pinyin-client');
    const { plainSyllable, toneOf } = await import('@/lib/pronunciation');
    const [xue] = await textToPinyin('雪');
    // 学 xué and 雪 xuě: same syllable, different tone.
    expect(plainSyllable(xue.readings[0])).toBe('xue');
    expect(toneOf(xue.readings[0])).toBe(3);
    expect(toneOf('xué')).toBe(2);
  });
});
