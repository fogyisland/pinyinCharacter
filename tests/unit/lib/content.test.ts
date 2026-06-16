import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';

vi.mock('@/lib/db', () => ({
  getPool: vi.fn(),
}));
vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
}));

import { getPool } from '@/lib/db';
import { getContent } from '@/lib/content';

const mockedQuery = vi.fn();
(getPool as any).mockReturnValue({ query: mockedQuery });

describe('getContent', () => {
  beforeEach(() => {
    vi.mocked(existsSync).mockReset();
    vi.mocked(readFileSync).mockReset();
    mockedQuery.mockReset();
  });

  it('returns from file when data/content/<char>.json exists', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
      char: '一', pinyin: 'yī', meaning_zh: '一,数之始也。',
    }));

    const result = await getContent('一');
    expect(result).toEqual({
      char: '一', pinyin: 'yī', meaning_zh: '一,数之始也。',
    });
    expect(mockedQuery).not.toHaveBeenCalled();
  });

  it('falls back to DB when file missing, returns merged 4-table data', async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    mockedQuery
      .mockResolvedValueOnce([[{ pinyin: 'yī', meaning_zh: '一,数之始。' }]]) // chars
      .mockResolvedValueOnce([[{ story: '甲骨文作一...' }]])                  // char_etymology
      .mockResolvedValueOnce([[]])                                            // char_story (no row)
      .mockResolvedValueOnce([[]])                                            // rare_chars (no row)

    const result = await getContent('一');
    expect(result?.char).toBe('一');
    expect(result?.pinyin).toBe('yī');
    expect(result?.dict?.meaning_zh).toBe('一,数之始。');
    expect(result?.etymology?.story).toBe('甲骨文作一...');
    expect(result?.hanzi_story).toBeUndefined();
  });

  it('returns null when no file + DB has no chars row', async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    mockedQuery.mockResolvedValueOnce([[]]);  // chars miss

    const result = await getContent('䨺');
    expect(result).toBeNull();
  });

  it('handles null meaning_zh from DB (preserve as undefined)', async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    mockedQuery
      .mockResolvedValueOnce([[{ pinyin: 'yī', meaning_zh: null }]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[]])

    const result = await getContent('一');
    expect(result?.dict?.meaning_zh).toBeUndefined();
    expect(result?.meaning_zh).toBeUndefined();
  });
});