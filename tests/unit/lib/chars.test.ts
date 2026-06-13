import { describe, it, expect, beforeEach, vi } from 'vitest';
import { listChars } from '@/lib/chars';

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
