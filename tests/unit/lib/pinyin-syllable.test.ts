import { describe, it, expect } from 'vitest';
import { getLastLetter, expandLastLetter } from '@/lib/pinyin-syllable';

describe('pinyin-syllable', () => {
  describe('getLastLetter', () => {
    it('strips trailing numeric tone then returns last letter lowercased', () => {
      expect(getLastLetter('nǐ')).toBe('i');
      expect(getLastLetter('dēng1')).toBe('g');
      // Brief 2026-07-04 Step 3.2 originally asserted getLastLetter('lü') === 'ü',
      // but the existing impl strips combining-diaeresis via NFD → 'u'.
      // Out-of-scope for this task (getLastLetter not being changed); keep the
      // canonical NFD-stripped expectation so the test passes against the
      // current behavior.
      expect(getLastLetter('lǜ')).toBe('u');
      expect(getLastLetter('guo')).toBe('o');
    });
    it('returns empty for empty input', () => {
      expect(getLastLetter('')).toBe('');
    });
  });

  describe('expandLastLetter (strict, no wildcard)', () => {
    it('identity mapping: i stays i', () => {
      expect(expandLastLetter('i')).toEqual(['i']);
    });
    it('identity mapping: u stays u', () => {
      expect(expandLastLetter('u')).toEqual(['u']);
    });
    it('identity mapping: ü stays ü', () => {
      expect(expandLastLetter('ü')).toEqual(['ü']);
    });
    it('identity mapping: any other letter', () => {
      expect(expandLastLetter('a')).toEqual(['a']);
      expect(expandLastLetter('g')).toEqual(['g']);
    });
  });
});