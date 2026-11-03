/**
 * lib/game-round.ts — the HSK fallback.
 *
 * 2026-11-03: the fallback used to re-filter the rows it had ALREADY
 * fetched with `hsk_level = ?`. So on a server whose HSK grading was never
 * imported — every `hsk_level` NULL, because `scripts/import-hsk.ts` is a
 * deployment script and not a migration — the "fallback" pool was the same
 * empty pool, and the round failed with `no_chars`.
 *
 * In other words the fallback could never help in the one case it exists
 * for. It now fetches the unfiltered pool, which is what `lib/chars.ts`
 * documents: "callers needing the fallback path should call listChars
 * without `hskLevel`".
 *
 * The char table is mocked, so the test needs no DB.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

vi.mock('@/lib/chars', () => ({
  listChars: vi.fn(),
}));

import { listChars } from '@/lib/chars';
import { buildRound } from '@/lib/game-round';

/**
 * A pool char.
 *
 * The round needs a non-empty radical and a tone-marked pinyin, so both are
 * set — `toneFromPinyin` has to recognise the tone mark.
 */
function poolChar(char: string, pinyin: string, level: 1 | 2 | 3 = 1) {
  return {
    char,
    pinyin,
    meaningZh: 'meaning',
    radical: '口',
    level,
    hskLevel: null as number | null,
    strokeCount: 1,
    unicodeCodepoint: 1,
  };
}

/** A pool of four usable chars — enough for a round of four. */
const POOL = [
  poolChar('好', 'hǎo'),
  poolChar('你', 'nǐ'),
  poolChar('大', 'dà'),
  poolChar('水', 'shuǐ'),
];

/** The page shape `listChars` returns. */
function page(chars: ReturnType<typeof poolChar>[]) {
  return { chars, total: chars.length, page: 1, pageSize: 80 };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('buildRound — the HSK fallback', () => {
  it('builds a round from the unfiltered pool when the tier is empty', async () => {
    // The HSK-filtered query returns nothing; the unfiltered one returns a
    // usable pool. The round must be built from the second one.
    vi.mocked(listChars)
      .mockResolvedValueOnce(page([]))
      .mockResolvedValueOnce(page(POOL));
    const result = await buildRound(4, 1, 'chars-all', 1, 'tone');
    expect(result).not.toBeNull();
    expect(result?.round.chars).toHaveLength(4);
  });

  it('reports the fallback and that the tier was missing', async () => {
    vi.mocked(listChars)
      .mockResolvedValueOnce(page([]))
      .mockResolvedValueOnce(page(POOL));
    const result = await buildRound(4, 1, 'chars-all', 1, 'tone');
    expect(result?.hskFallback).toBe(true);
    expect(result?.hskTierEmpty).toBe(true);
  });

  it('asks the database twice — the filtered one and the fallback one', async () => {
    vi.mocked(listChars)
      .mockResolvedValueOnce(page([]))
      .mockResolvedValueOnce(page(POOL));
    await buildRound(4, 1, 'chars-all', 1, 'tone');
    expect(listChars).toHaveBeenCalledTimes(2);
    // The second call must NOT repeat the HSK filter — that is the whole
    // point of the fallback.
    const second = vi.mocked(listChars).mock.calls[1]?.[0];
    expect(second?.hskLevel).toBeUndefined();
  });

  it('does not fall back when the tier HAS enough chars', async () => {
    vi.mocked(listChars).mockResolvedValue(page(POOL));
    const result = await buildRound(4, 1, 'chars-all', 1, 'tone');
    expect(result?.hskFallback).toBe(false);
    expect(result?.hskTierEmpty).toBe(false);
    // One query — the fallback is a last resort, not a second pass.
    expect(listChars).toHaveBeenCalledTimes(1);
  });

  it('reports a thin tier as thin, not as missing', async () => {
    // One char in the tier, four needed: the tier is not empty, so the
    // banner must not claim the grading was never imported.
    vi.mocked(listChars)
      .mockResolvedValueOnce(page([POOL[0]!]))
      .mockResolvedValueOnce(page(POOL));
    const result = await buildRound(4, 1, 'chars-all', 1, 'tone');
    expect(result?.hskFallback).toBe(true);
    expect(result?.hskTierEmpty).toBe(false);
  });

  it('gives up when even the unfiltered pool is too small', async () => {
    vi.mocked(listChars)
      .mockResolvedValueOnce(page([]))
      .mockResolvedValueOnce(page([POOL[0]!]));
    const result = await buildRound(4, 1, 'chars-all', 1, 'tone');
    expect(result).toBeNull();
  });

  it('does not fall back when no HSK level was requested', async () => {
    vi.mocked(listChars).mockResolvedValue(page(POOL));
    const result = await buildRound(4, 1, 'chars-all', null, 'tone');
    expect(result?.hskFallback).toBe(false);
    expect(listChars).toHaveBeenCalledTimes(1);
  });
});
