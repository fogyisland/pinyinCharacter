/**
 * The quest data layer's memo.
 *
 * The data layer caches the built tier per HSK tier, so the first request
 * pays for the database read and every later request is a hit. A *failed*
 * build must not stay in the memo: one transient database error would
 * otherwise turn into a permanently broken tier until the process restarts.
 *
 * The database is mocked, so the test never opens a connection.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// 'server-only' throws outside a React Server Component graph. The data layer
// (and lib/content.ts behind it) is marked server-only, so the marker is
// neutralized for the test process.
vi.mock('server-only', () => ({}));

// vi.hoisted runs before the mock factories, so the query spy exists by the
// time the mocked module is created.
const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));

vi.mock('@/lib/db', () => ({
  getPool: () => ({ query: queryMock }),
  closePool: vi.fn(),
}));

import { getQuestTier, clearQuestTierMemo } from '@/lib/game-quest-data';

beforeEach(() => {
  queryMock.mockReset();
  clearQuestTierMemo();
});

describe('the quest tier memo', () => {
  it('a failed build is evicted, so the next call retries the database', async () => {
    queryMock.mockRejectedValueOnce(new Error('db is down'));
    queryMock.mockResolvedValueOnce([[]]);

    // The first call fails ...
    await expect(getQuestTier(1)).rejects.toThrow('db is down');

    // ... and the second call retries instead of returning the memoized
    // rejection.
    const tier = await getQuestTier(1);
    expect(tier).toBeDefined();
    expect(tier.tier).toBe(1);
    expect(tier.tierSize).toBe(0);
    expect(tier.levels).toEqual([]);

    // Two queries: the retry really hit the database again.
    expect(queryMock).toHaveBeenCalledTimes(2);
  });

  it('a successful build is memoized, so a second call does not query again', async () => {
    // A tier that HAS rows. An *empty* tier is deliberately not memoized
    // (see game-quest-data-empty-tier.test.ts): it means "the HSK grading
    // has not been imported yet", and caching that would freeze the
    // answer for the life of the process.
    queryMock.mockResolvedValue([[{ char: '一', pinyin: 'yī', radical: '一' }]]);

    const first = await getQuestTier(1);
    const second = await getQuestTier(1);

    expect(second).toBe(first);
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it('an empty tier is evicted, so the next call re-reads the database', async () => {
    // The tier was empty because `scripts/import-hsk.ts` had not run yet.
    // Once the data lands, the server must see it without a restart.
    queryMock.mockResolvedValueOnce([[]]);
    queryMock.mockResolvedValueOnce([[{ char: '一', pinyin: 'yī', radical: '一' }]]);

    const first = await getQuestTier(1);
    expect(first.tierSize).toBe(0);

    const second = await getQuestTier(1);
    expect(second.tierSize).toBeGreaterThan(0);
    expect(queryMock).toHaveBeenCalledTimes(2);
  });
});
