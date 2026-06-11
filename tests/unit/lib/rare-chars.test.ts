import { describe, it, expect } from 'vitest';
import { pickDailyChar, buildSearchWhere, isSingleChar } from '@/lib/rare-chars';

describe('rare-chars pure helpers', () => {
  describe('pickDailyChar', () => {
    it('returns a char from the list', () => {
      const chars = ['龘', '齉', '麤', '鱻'];
      const result = pickDailyChar(chars, '2026-06-11');
      expect(chars).toContain(result);
    });

    it('same date returns same char', () => {
      const chars = ['龘', '齉', '麤', '鱻', '龍', '龜'];
      expect(pickDailyChar(chars, '2026-06-11')).toBe(pickDailyChar(chars, '2026-06-11'));
    });

    it('different dates may return different chars (probabilistic)', () => {
      const chars = Array.from({ length: 100 }, (_, i) => String.fromCodePoint(0x4e00 + i));
      const set = new Set<string>();
      for (let d = 1; d <= 30; d++) {
        set.add(pickDailyChar(chars, `2026-06-${String(d).padStart(2, '0')}`));
      }
      expect(set.size).toBeGreaterThanOrEqual(10);
    });
  });

  describe('buildSearchWhere', () => {
    it('returns empty string for empty query (returns all)', () => {
      expect(buildSearchWhere('')).toEqual({ where: '', params: [] });
    });

    it('matches exact single char with =', () => {
      expect(buildSearchWhere('龘')).toEqual({
        where: 'WHERE `char` = ?',
        params: ['龘'],
      });
    });

    it('matches multi-char or pinyin substring with LIKE', () => {
      expect(buildSearchWhere('da')).toEqual({
        where: 'WHERE pinyin LIKE ?',
        params: ['%da%'],
      });
    });
  });

  describe('isSingleChar', () => {
    it('returns true for a single CJK char', () => {
      expect(isSingleChar('龘')).toBe(true);
      expect(isSingleChar('你')).toBe(true);
    });

    it('returns false for empty or multi-char strings', () => {
      expect(isSingleChar('')).toBe(false);
      expect(isSingleChar('你好')).toBe(false);
      expect(isSingleChar('a')).toBe(false);
    });
  });
});
