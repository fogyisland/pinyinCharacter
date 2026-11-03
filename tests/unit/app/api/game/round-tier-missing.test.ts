/**
 * GET /api/game/round and GET /api/chars — an HSK tier that holds no chars.
 *
 * 2026-11-03: the production server answered 503 `no_chars` for
 * `/api/game/round?hskLevel=1`, and the client showed the learner the raw
 * code. The real cause was the same as the quest route's 404: `chars.hsk_level`
 * had never been filled on that server, so the tier's query returned nothing.
 *
 * "There are not enough chars" and "the HSK grading was never imported" are
 * different situations with different fixes, and the first one hides the
 * second one completely. The route must therefore count the tier before it
 * gives up, and answer 503 with a code that names the cause.
 *
 * The handlers are called directly — no server is started. The data layer is
 * mocked, so the test needs no DB.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));

vi.mock('@/lib/game-round', () => ({
  buildRound: vi.fn(),
}));

vi.mock('@/lib/chars', () => ({
  countCharsByHskLevel: vi.fn(),
  listChars: vi.fn(),
}));

import { buildRound } from '@/lib/game-round';
import { countCharsByHskLevel, listChars } from '@/lib/chars';
import { HSK_LEVELS_NOT_IMPORTED } from '@/lib/game-quest-types';
import { GET as ROUND_GET } from '@/app/api/game/round/route';
import { GET as CHARS_GET } from '@/app/api/chars/route';

/** One char of the char pool, as `listChars` returns it. */
const POOL_CHAR = {
  char: '好',
  pinyin: 'hǎo',
  pinyinAlt: [],
  meaningZh: 'good',
  meaningEn: null,
  radical: '女',
  level: 1 as const,
  hskLevel: null,
  strokeCount: 6,
  unicodeCodepoint: '22909',
  variants: [],
};

function makeReq(path: string, query: string): NextRequest {
  return new NextRequest(`http://localhost${path}${query}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(countCharsByHskLevel).mockResolvedValue(178);
  vi.mocked(listChars).mockResolvedValue({
    chars: [POOL_CHAR],
    total: 1,
    page: 1,
    pageSize: 80,
  });
});

describe('GET /api/game/round — the tier was never imported', () => {
  it('answers 503 with the code that names the cause', async () => {
    vi.mocked(buildRound).mockResolvedValue(null);
    vi.mocked(countCharsByHskLevel).mockResolvedValue(0);
    const res = await ROUND_GET(makeReq('/api/game/round', '?count=4&hskLevel=1'));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe(HSK_LEVELS_NOT_IMPORTED);
  });

  it('puts the command that fixes it into the message', async () => {
    vi.mocked(buildRound).mockResolvedValue(null);
    vi.mocked(countCharsByHskLevel).mockResolvedValue(0);
    const res = await ROUND_GET(makeReq('/api/game/round', '?count=4&hskLevel=1'));
    const body = await res.json();
    expect(body.error.message).toContain('import-hsk.ts');
  });

  it('still answers no_chars when the tier EXISTS but the pool is too small', async () => {
    // The tier has 178 chars, so the shortage is a real shortage — not a
    // missing grading. The two must not be confused.
    vi.mocked(buildRound).mockResolvedValue(null);
    vi.mocked(countCharsByHskLevel).mockResolvedValue(178);
    const res = await ROUND_GET(makeReq('/api/game/round', '?count=4&hskLevel=1'));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe('no_chars');
  });

  it('does not count the tier when no HSK level was requested', async () => {
    vi.mocked(buildRound).mockResolvedValue(null);
    const res = await ROUND_GET(makeReq('/api/game/round', '?count=4'));
    const body = await res.json();
    // Without an HSK level there is no tier to count — the count would be a
    // pointless query, and its result could not change the answer.
    expect(countCharsByHskLevel).not.toHaveBeenCalled();
    expect(body.error.code).toBe('no_chars');
  });
});

describe('GET /api/chars — the HSK fallback', () => {
  it('falls back to the unfiltered pool when the tier is empty', async () => {
    vi.mocked(listChars)
      .mockResolvedValueOnce({ chars: [], total: 0, page: 1, pageSize: 80 })
      .mockResolvedValueOnce({ chars: [POOL_CHAR], total: 1, page: 1, pageSize: 80 });
    const res = await CHARS_GET(makeReq('/api/chars', '?hskLevel=1&page=1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.chars).toHaveLength(1);
  });

  it('reports the fallback and that the tier was missing', async () => {
    vi.mocked(listChars)
      .mockResolvedValueOnce({ chars: [], total: 0, page: 1, pageSize: 80 })
      .mockResolvedValueOnce({ chars: [POOL_CHAR], total: 1, page: 1, pageSize: 80 });
    const res = await CHARS_GET(makeReq('/api/chars', '?hskLevel=1&page=1'));
    const body = await res.json();
    expect(body.hskFallback).toBe(true);
    expect(body.hskTierEmpty).toBe(true);
  });

  it('asks the database twice — the filtered one and the fallback one', async () => {
    vi.mocked(listChars)
      .mockResolvedValueOnce({ chars: [], total: 0, page: 1, pageSize: 80 })
      .mockResolvedValueOnce({ chars: [POOL_CHAR], total: 1, page: 1, pageSize: 80 });
    await CHARS_GET(makeReq('/api/chars', '?hskLevel=1&page=1'));
    expect(listChars).toHaveBeenCalledTimes(2);
    // The second call must NOT repeat the HSK filter — that is the whole
    // point of the fallback.
    const second = vi.mocked(listChars).mock.calls[1]?.[0];
    expect(second?.hskLevel).toBeUndefined();
  });

  it('does not fall back when the tier HAS chars', async () => {
    vi.mocked(listChars).mockResolvedValue({
      chars: [POOL_CHAR],
      total: 1,
      page: 1,
      pageSize: 80,
    });
    const res = await CHARS_GET(makeReq('/api/chars', '?hskLevel=1&page=1'));
    const body = await res.json();
    expect(body.hskFallback).toBe(false);
    expect(body.hskTierEmpty).toBe(false);
    expect(listChars).toHaveBeenCalledTimes(1);
  });

  it('does not fall back when no HSK level was requested', async () => {
    vi.mocked(listChars).mockResolvedValue({
      chars: [POOL_CHAR],
      total: 1,
      page: 1,
      pageSize: 80,
    });
    const res = await CHARS_GET(makeReq('/api/chars', '?page=1'));
    const body = await res.json();
    expect(body.hskFallback).toBe(false);
    expect(listChars).toHaveBeenCalledTimes(1);
  });
});
