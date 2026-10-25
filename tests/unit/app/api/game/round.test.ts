/**
 * GET /api/game/round?mode=tone
 *
 * 2026-10-25 (Task 5): the round route is demoted to 「每日一局」 but it
 * still owns the `mode` query parameter. The parameter was parsed and used
 * for the reveal config, yet it never reached buildRound — so the round
 * itself was always a random one of the three and the tab title could lie
 * about its own content.
 *
 * The handler is called directly — no server is started (the convention of
 * tests/unit/app/api/game/quest.test.ts). The data layer is mocked, so the
 * test needs no DB.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// 'server-only' throws outside a React Server Component graph. The marker is
// neutralized for the test process.
vi.mock('server-only', () => ({}));

// Only buildRound is needed by the route; the rest of the module is data
// access that must not reach the DB in a unit test.
vi.mock('@/lib/game-round', () => ({
  buildRound: vi.fn(),
}));

import { buildRound } from '@/lib/game-round';
import type { GameRound } from '@/lib/game-round-types';
import { GET } from '@/app/api/game/round/route';

const FIXTURE_ROUND: GameRound = {
  mode: 'tone',
  chars: [
    { char: '好', pinyin: 'hǎo', meaning: 'good', radical: '女' },
    { char: '你', pinyin: 'nǐ', meaning: 'you', radical: '亻' },
    { char: '大', pinyin: 'dà', meaning: 'big', radical: '大' },
    { char: '水', pinyin: 'shuǐ', meaning: 'water', radical: '水' },
  ],
  charToAnswer: {
    好: { tone: 3, radical: '女', pinyin: 'hǎo' },
    你: { tone: 3, radical: '亻', pinyin: 'nǐ' },
    大: { tone: 4, radical: '大', pinyin: 'dà' },
    水: { tone: 3, radical: '水', pinyin: 'shuǐ' },
  },
  toneChoices: [1, 2, 3, 4],
  radicalChoices: ['女', '亻', '大', '水'],
  pinyinChoices: ['hǎo', 'nǐ', 'dà', 'shuǐ'],
};

function makeReq(query: string): NextRequest {
  return new NextRequest(`http://localhost/api/game/round${query}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  // The fixture echoes the requested mode so the route's payload can be
  // checked end to end.
  vi.mocked(buildRound).mockImplementation(async (_count, _seed, _source, _hskLevel, mode) => ({
    round: { ...FIXTURE_ROUND, mode: mode ?? 'pinyin' },
    hskFallback: false,
    hskLevel: null,
  }));
});

describe('GET /api/game/round — mode forwarding (Task 5)', () => {
  it('passes the requested mode to buildRound as its 5th argument', async () => {
    const res = await GET(makeReq('?mode=tone&count=4'));
    expect(res.status).toBe(200);
    expect(buildRound).toHaveBeenCalledTimes(1);
    const args = vi.mocked(buildRound).mock.calls[0];
    expect(args?.[0]).toBe(4);
    expect(args?.[4]).toBe('tone');
  });

  it('echoes the requested mode in the response payload', async () => {
    const res = await GET(makeReq('?mode=tone&count=4'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.mode).toBe('tone');
  });

  it('forwards a radical request as well', async () => {
    const res = await GET(makeReq('?mode=radical&count=4'));
    expect(res.status).toBe(200);
    const args = vi.mocked(buildRound).mock.calls[0];
    expect(args?.[4]).toBe('radical');
    const body = await res.json();
    expect(body.data.mode).toBe('radical');
  });

  it('forwards a pinyin request as well', async () => {
    const res = await GET(makeReq('?mode=pinyin&count=4'));
    expect(res.status).toBe(200);
    const args = vi.mocked(buildRound).mock.calls[0];
    expect(args?.[4]).toBe('pinyin');
    const body = await res.json();
    expect(body.data.mode).toBe('pinyin');
  });

  it('passes undefined as the 5th argument when no mode is requested', async () => {
    const res = await GET(makeReq('?count=4'));
    expect(res.status).toBe(200);
    expect(buildRound).toHaveBeenCalledTimes(1);
    const args = vi.mocked(buildRound).mock.calls[0];
    // The route must not invent a default mode — an absent parameter has to
    // reach buildRound as `undefined` so the legacy random behavior stays.
    expect(args).toHaveLength(5);
    expect(args?.[4]).toBeUndefined();
  });

  it('keeps the response shape unchanged', async () => {
    const res = await GET(makeReq('?mode=tone&count=4'));
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(
      ['data', 'hskFallback', 'hskLevel', 'ok', 'revealConfig'].sort(),
    );
    expect(Object.keys(body.data).sort()).toEqual(
      ['charToAnswer', 'chars', 'mode', 'pinyinChoices', 'radicalChoices', 'toneChoices'].sort(),
    );
  });

  it('still rejects an unknown mode with 400 bad_input', async () => {
    const res = await GET(makeReq('?mode=bogus'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('bad_input');
    expect(buildRound).not.toHaveBeenCalled();
  });
});
