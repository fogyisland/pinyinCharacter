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

  it('queries chars table with char-exact search (pinyin-only search is post-migration-degraded)', async () => {
    mockedQuery.mockResolvedValueOnce([[{ char: '你', pinyin: 'nǐ', level: 1, radical: '亻', stroke_count: 7, unicode_codepoint: 'U+4F60' }], []]);
    mockedQuery.mockResolvedValueOnce([[{ n: 1 }]]);

    const result = await listChars({ q: '你', page: 1 });

    expect(mockedQuery).toHaveBeenCalledTimes(2);
    expect(mockedQuery.mock.calls[0][0]).toContain('FROM chars');
    expect(mockedQuery.mock.calls[0][0]).toContain('`char` = ?');
    // Post-migration: pinyin/meaning_en are no longer in DB so the old LIKE
    // search is gone. The DB query is now slim.
    expect(mockedQuery.mock.calls[0][0]).not.toContain('meaning_en');
    expect(mockedQuery.mock.calls[0][0]).not.toContain('pinyin_alt');
    expect(mockedQuery.mock.calls[0][0]).not.toContain('variants');
    expect(mockedQuery.mock.calls[0][1]).toEqual(['你', 80, 0]);
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
    mockedQuery.mockResolvedValueOnce([[{ char: '一', level: 1, pinyin: 'yī', radical: '一', stroke_count: 1, unicode_codepoint: 'U+4E00' }]]);
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

  it('returns char + related by radical; related-by-pinyin is empty (post-migration pinyin DB col is empty)', async () => {
    // getChar query
    mockedQuery.mockResolvedValueOnce([[{ char: '一', level: 1, pinyin: 'yī', radical: '一', stroke_count: 1, unicode_codepoint: 'U+4E00' }]]);
    // relatedByRadical (limit 8)
    mockedQuery.mockResolvedValueOnce([[{ char: '丁', level: 1, pinyin: 'dīng', radical: '一', stroke_count: 2, unicode_codepoint: 'U+4E01' }]]);

    const result = await getCharDetail('一');
    expect(result?.char).toBe('一');
    expect(result?.relatedByRadical).toHaveLength(1);
    // relatedByPinyin: not supported post-migration (DB pinyin is mostly
    // empty for L1/L2/L3 chars, so the old `pinyin = ?` filter would
    // return nothing). Returns [] until we re-derive pinyin via JSON or
    // pinyin-pro in a separate index.
    expect(result?.relatedByPinyin).toEqual([]);
    // No third (pinyin) query should be issued.
    expect(mockedQuery).toHaveBeenCalledTimes(2);
  });

  it('returns null when char not found', async () => {
    mockedQuery.mockResolvedValueOnce([[]]);
    const result = await getCharDetail('X');
    expect(result).toBeNull();
  });
});
