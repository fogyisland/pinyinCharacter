import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';

vi.mock('@/lib/db', () => ({ getPool: vi.fn() }));
vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
  readdirSync: vi.fn(),
  existsSync: vi.fn(),
}));

import { getPool } from '@/lib/db';
import { selectNextChars } from './select-next-chars';

const mockedQuery = vi.fn();
(getPool as any).mockReturnValue({ query: mockedQuery });

describe('selectNextChars', () => {
  beforeEach(() => {
    vi.mocked(readFileSync).mockReset();
    vi.mocked(readdirSync).mockReset();
    vi.mocked(existsSync).mockReset();
    mockedQuery.mockReset();
  });

  it('returns 30 chars from chars table when nothing in data/content/', async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(readdirSync).mockReturnValue([]);
    // n=8105 → meaningGap=0, so meaning path skipped; hanzi path runs first
    mockedQuery.mockResolvedValueOnce([[{ n: 8105 }]]);
    mockedQuery.mockResolvedValueOnce([[
      { char: '龘' }, { char: '䨺' }, { char: '䨻' },
    ].concat(Array.from({ length: 27 }, (_, i) => ({ char: String.fromCodePoint(0x3400 + i) })))]);

    const result = await selectNextChars(30);
    expect(result).toHaveLength(30);
    expect(result[0]).toEqual({ char: '龘', fieldsToFill: ['hanzi_story'] });
  });

  it('excludes chars already with full data in data/content/', async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(readdirSync).mockReturnValue(['一.json', '丁.json'] as any);
    vi.mocked(readFileSync).mockImplementation((p) => {
      if (String(p).endsWith('一.json')) return JSON.stringify({ char: '一', pinyin: 'yī', meaning_zh: 'x', etymology_story: 'y'.repeat(150), hanzi_story: 'z'.repeat(20) });
      if (String(p).endsWith('丁.json')) return JSON.stringify({ char: '丁', pinyin: 'dīng', meaning_zh: 'x' });
      return '{}';
    });
    // n=8105 → meaningGap=0, meaning path skipped; hanzi path runs first
    mockedQuery
      .mockResolvedValueOnce([[{ n: 8105 }]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[
        { char: '七' }, { char: '万' },
      ].concat(Array.from({ length: 28 }, (_, i) => ({ char: String.fromCodePoint(0x3400 + i) })))]);

    const result = await selectNextChars(30);
    expect(result.length).toBeLessThanOrEqual(30);
    expect(result.find(r => r.char === '一')).toBeUndefined();
  });

  it('returns empty array when all 3 fields fully covered', async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(readdirSync).mockReturnValue([]);
    // n=8105 → meaningGap=0, skip meaning; hanzi gap>0 (1 query); etym gap>0 (2 queries for levels 1+2)
    mockedQuery
      .mockResolvedValueOnce([[{ n: 8105 }]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[]]);

    const result = await selectNextChars(30);
    expect(result).toEqual([]);
  });
});