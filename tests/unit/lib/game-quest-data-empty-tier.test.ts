import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({
  getPool: () => ({ query: queryMock }),
}));

import { getQuestTier, clearQuestTierMemo } from '@/lib/game-quest-data';

/**
 * A row as `SELECT char, pinyin, radical FROM chars WHERE hsk_level = ?`
 * returns it.
 */
function row(char: string): { char: string; pinyin: string; radical: string } {
  return { char, pinyin: 'yī', radical: '一' };
}

beforeEach(() => {
  vi.clearAllMocks();
  clearQuestTierMemo();
});

describe('getQuestTier — an empty tier is not cached', () => {
  it('queries again after the tier turned out to be empty', async () => {
    // The defect: an empty tier is memoized forever, so after the operator
    // runs `scripts/import-hsk.ts` the server keeps answering "the HSK
    // grading was never imported" — and the very message that names that
    // command makes the operator think it should have worked.
    //
    // An empty tier means "the data is not ready yet", not "the tier is
    // empty forever", so it must not be cached.
    queryMock.mockResolvedValueOnce([[]]);
    queryMock.mockResolvedValueOnce([[row('一')]]);

    const first = await getQuestTier(1);
    expect(first.tierSize).toBe(0);

    const second = await getQuestTier(1);

    expect(queryMock).toHaveBeenCalledTimes(2);
    expect(second.tierSize).toBeGreaterThan(0);
  });

  it('still caches a tier that has rows', async () => {
    queryMock.mockResolvedValue([[row('一')]]);

    await getQuestTier(1);
    await getQuestTier(1);

    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it('does not cache a failed build', async () => {
    queryMock.mockRejectedValueOnce(new Error('db is down'));
    queryMock.mockResolvedValueOnce([[row('一')]]);

    await expect(getQuestTier(1)).rejects.toThrow('db is down');

    const second = await getQuestTier(1);
    expect(second.tierSize).toBeGreaterThan(0);
  });
});
