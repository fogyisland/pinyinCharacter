// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { parseJieba, buildToneTable } from '@/scripts/build-pinyin-tone';

/**
 * The tone-aware table builder's own logic, without the network.
 *
 * A mistake here would silently rank a rare character above a common one —
 * the exact defect this table exists to fix — so the parser and the builder
 * are pinned separately from the downloaded data.
 */
describe('the tone-aware table builder', () => {
  describe('parseJieba', () => {
    it('reads word frequencies and single-character frequencies', () => {
      const text = ['是 796991 v', '你们 1234 r', '# comment', ''].join('\n');
      const { wordFreqs, charFreqs } = parseJieba(text);
      expect(wordFreqs.get('是')).toBe(796991);
      expect(wordFreqs.get('你们')).toBe(1234);
      // 是 appears as a single-character word, so it lands in charFreqs too.
      expect(charFreqs.get('是')).toBe(796991);
      // A multi-character word must not contribute a "single character".
      expect(charFreqs.get('你')).toBeUndefined();
    });

    it('ignores lines without a numeric frequency', () => {
      const text = ['是 abc v', '你 796991 r'].join('\n');
      const { wordFreqs } = parseJieba(text);
      expect(wordFreqs.has('是')).toBe(false);
      expect(wordFreqs.get('你')).toBe(796991);
    });

    it('keeps the largest frequency when a word repeats', () => {
      const text = ['你 10 r', '你 500 r'].join('\n');
      const { wordFreqs } = parseJieba(text);
      expect(wordFreqs.get('你')).toBe(500);
    });
  });

  describe('buildToneTable', () => {
    /** Two characters, one syllable each, with different jieba weights. */
    const charFreqs = new Map([
      ['你', 234587],
      ['泥', 1919],
    ]);

    it('keys the table by the TONED syllable, not the plain one', () => {
      const table = buildToneTable('你: nǐ\n泥: ní', charFreqs);
      // nǐ and ní must not land in the same bucket: that is the whole point.
      expect(table['ni3']?.[0]?.char).toBe('你');
      expect(table['ni2']?.[0]?.char).toBe('泥');
      expect(table['ni']).toBeUndefined();
    });

    it('ranks by the corpus frequency of the character', () => {
      const table = buildToneTable('你: nǐ\n拟: nǐ', new Map([
        ['你', 234587],
        ['拟', 1919],
      ]));
      expect(table['ni3']?.map((e) => e.char)).toEqual(['你', '拟']);
    });

    it('skips a line whose syllable count does not match the word', () => {
      const table = buildToneTable('你好: nǐ', new Map());
      expect(Object.keys(table)).toHaveLength(0);
    });

    it('skips a line with no pinyin after the colon', () => {
      const table = buildToneTable('你:', new Map());
      expect(Object.keys(table)).toHaveLength(0);
    });

    it('drops characters below the requested frequency floor', () => {
      const table = buildToneTable('你: nǐ\n泥: nǐ', charFreqs, 100);
      // 泥 (1919) survives, so use a floor above it to prove the drop works.
      const strict = buildToneTable('你: nǐ\n泥: nǐ', charFreqs, 100000);
      expect(strict['ni3']?.map((e) => e.char)).toEqual(['你']);
      expect(table['ni3']).toHaveLength(2);
    });

    it('keeps an unknown character in the bucket at the bottom', () => {
      // A character jieba does not know gets weight 1 — it must still be
      // offered, just after the common ones.
      const table = buildToneTable('你: nǐ\n囸: nǐ', charFreqs);
      expect(table['ni3']?.map((e) => e.char)).toEqual(['你', '囸']);
    });
  });
});
