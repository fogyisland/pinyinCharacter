import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({
  getPool: () => ({ query: (...a: unknown[]) => queryMock(...a) }),
}));

import { pickDailyChar, buildSearchWhere, isSingleChar, getRandomStoryChar } from '@/lib/rare-chars';

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

describe('getRandomStoryChar', () => {
  beforeEach(() => queryMock.mockReset());
  afterEach(() => vi.restoreAllMocks());

  it('returns null when no rows', async () => {
    queryMock.mockResolvedValue([[]]);
    const r = await getRandomStoryChar();
    expect(r).toBeNull();
  });

  it('returns mapped RareChar when row exists', async () => {
    queryMock.mockResolvedValue([[{
      char: '龘', pinyin: 'dá', meaning: '古龙', story: '从前有龙',
      needs_review: 1, generated_by: 'openai:gpt-4o-mini',
      generated_at: new Date('2026-05-12T08:30:00Z'), created_at: new Date('2026-05-12T08:00:00Z'),
    }]]);
    const r = await getRandomStoryChar();
    expect(r).toEqual({
      char: '龘', pinyin: 'dá', meaning: '古龙', story: '从前有龙',
      needsReview: true, generatedBy: 'openai:gpt-4o-mini',
      generatedAt: new Date('2026-05-12T08:30:00Z'), createdAt: new Date('2026-05-12T08:00:00Z'),
    });
  });

  it('queries with story <> "" filter', async () => {
    queryMock.mockResolvedValue([[]]);
    await getRandomStoryChar();
    const [sql, params] = queryMock.mock.calls[0]!;
    expect(String(sql)).toMatch(/FROM rare_chars/);
    expect(String(sql)).toMatch(/story\s+<>\s*''/);
    expect(String(sql)).toMatch(/ORDER BY RAND\(\)/);
    expect(params).toEqual([1]);
  });
});
