import { describe, it, expect, beforeEach, vi } from 'vitest';
import { listChars, getChar, getCharDetail } from '@/lib/chars';

vi.mock('@/lib/db', () => ({
  getPool: vi.fn(),
}));

import { getPool } from '@/lib/db';

const mockedQuery = vi.fn();
(getPool as any).mockReturnValue({ query: mockedQuery, execute: mockedQuery });

describe('listChars', () => {
  beforeEach(() => mockedQuery.mockReset());

  it('queries chars table with pinyin search', async () => {
    mockedQuery.mockResolvedValueOnce([[{ char: '你', pinyin: 'nǐ', level: 1, radical: '亻', stroke_count: 7, pinyin_alt: null, meaning_zh: null, meaning_en: null, unicode_codepoint: 'U+4F60', variants: null }], []]);
    mockedQuery.mockResolvedValueOnce([[{ n: 1 }]]);

    const result = await listChars({ q: 'ni', page: 1 });

    expect(mockedQuery).toHaveBeenCalledTimes(2);
    expect(mockedQuery.mock.calls[0][0]).toContain('FROM chars');
    expect(mockedQuery.mock.calls[0][0]).toContain('LIKE');
    expect(mockedQuery.mock.calls[0][0]).toContain('`char` = ?');
    expect(mockedQuery.mock.calls[0][0]).toContain('meaning_en LIKE ?');
    expect(mockedQuery.mock.calls[0][1]).toEqual(['%ni%', 'ni', '%ni%', 80, 0]);
    expect(result.total).toBe(1);
    expect(result.chars[0].char).toBe('你');
  });

  it('filters by level=3 only', async () => {
    mockedQuery.mockResolvedValueOnce([[], []]);
    mockedQuery.mockResolvedValueOnce([[{ n: 0 }]]);

    await listChars({ level: 3, page: 1 });

    expect(mockedQuery.mock.calls[0][0]).toContain('level = ?');
    expect(mockedQuery.mock.calls[0][1]).toEqual([3, 80, 0]);
  });

  it('filters by letter (pinyin LIKE a%)', async () => {
    mockedQuery.mockResolvedValueOnce([[], []]);
    mockedQuery.mockResolvedValueOnce([[{ n: 0 }]]);

    await listChars({ letter: 'A', page: 1 });

    expect(mockedQuery.mock.calls[0][0]).toContain('pinyin LIKE ?');
    expect(mockedQuery.mock.calls[0][1]).toEqual(['A%', 80, 0]);
  });

  it('filters by radical', async () => {
    mockedQuery.mockResolvedValueOnce([[], []]);
    mockedQuery.mockResolvedValueOnce([[{ n: 0 }]]);

    await listChars({ radical: '水', page: 1 });

    expect(mockedQuery.mock.calls[0][0]).toContain('radical = ?');
    expect(mockedQuery.mock.calls[0][1]).toEqual(['水', 80, 0]);
  });

  it('returns empty when 0 results', async () => {
    mockedQuery.mockResolvedValueOnce([[], []]);
    mockedQuery.mockResolvedValueOnce([[{ n: 0 }]]);

    const result = await listChars({ page: 1 });

    expect(result.chars).toEqual([]);
    expect(result.total).toBe(0);
  });
});

describe('getChar', () => {
  beforeEach(() => mockedQuery.mockReset());

  it('returns single char by string', async () => {
    mockedQuery.mockResolvedValueOnce([[{ char: '一', level: 1, pinyin: 'yī', pinyin_alt: null, radical: '一', stroke_count: 1, meaning_zh: '数目字', meaning_en: 'one', unicode_codepoint: 'U+4E00', variants: null }]]);
    const result = await getChar('一');
    expect(result?.char).toBe('一');
    expect(result?.strokeCount).toBe(1);
  });

  it('returns null when char not found', async () => {
    mockedQuery.mockResolvedValueOnce([[]]);
    const result = await getChar('X');
    expect(result).toBeNull();
  });
});

describe('getCharDetail', () => {
  beforeEach(() => mockedQuery.mockReset());

  it('returns char + related by radical + related by pinyin', async () => {
    // getChar query
    mockedQuery.mockResolvedValueOnce([[{ char: '一', level: 1, pinyin: 'yī', pinyin_alt: null, radical: '一', stroke_count: 1, meaning_zh: null, meaning_en: null, unicode_codepoint: 'U+4E00', variants: null }]]);
    // relatedByRadical (limit 8)
    mockedQuery.mockResolvedValueOnce([[{ char: '丁', level: 1, pinyin: 'dīng', pinyin_alt: null, radical: '一', stroke_count: 2, meaning_zh: null, meaning_en: null, unicode_codepoint: 'U+4E01', variants: null }]]);
    // relatedByPinyin (limit 8)
    mockedQuery.mockResolvedValueOnce([[{ char: '衣', level: 1, pinyin: 'yī', pinyin_alt: null, radical: '衤', stroke_count: 6, meaning_zh: null, meaning_en: null, unicode_codepoint: 'U+8863', variants: null }]]);

    const result = await getCharDetail('一');
    expect(result?.char).toBe('一');
    expect(result?.relatedByRadical).toHaveLength(1);
    expect(result?.relatedByPinyin).toHaveLength(1);
  });

  it('returns null when char not found', async () => {
    mockedQuery.mockResolvedValueOnce([[]]);
    const result = await getCharDetail('X');
    expect(result).toBeNull();
  });
});
