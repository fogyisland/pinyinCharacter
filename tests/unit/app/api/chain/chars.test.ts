/**
 * GET /api/chain/chars — which characters the game pool may hold.
 *
 * The route used to keep only rows whose pinyin matched
 * `TONE_DIACRITIC_RE`. That character class held 16 of pinyin's 24 tone
 * marks: it had no `á é í ó ú` and no `ǖ ǘ ǚ`, so every SECOND-tone
 * character — 麻 má, 人 rén, 学 xué — was dropped before
 * `toneFromPinyin` ever saw it.
 *
 * That is half of one of the two tone classes. A game that judges 平仄
 * needs both classes whole, and even the existing games were playing with
 * a pool missing a quarter of its characters.
 *
 * `toneFromPinyin` reads `TONE_MAP`, which holds all 24 marks, and it
 * already returns `null` for a neutral reading. So it is strictly stronger
 * than the regex, and the regex is gone.
 *
 * The handler is called directly — no server is started.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));

vi.mock('@/lib/chars', () => ({
  listChainCharPool: vi.fn(),
}));

import { listChainCharPool } from '@/lib/chars';
import { GET } from '@/app/api/chain/chars/route';

/** One row of the pool, in the shape `listChainCharPool` returns. */
function row(char: string, pinyin: string, meaningZh = '') {
  return { char, pinyin, meaningZh, radical: '口', level: 1 };
}

/** Calls the route with no query string — the pool is not filtered. */
async function call(): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await GET(new NextRequest('http://localhost/api/chain/chars'));
  return { status: response.status, body: await response.json() };
}

/** The characters a response holds, in order. */
function charsOf(body: Record<string, unknown>): string[] {
  return (body.chars as Array<{ char: string }>).map((entry) => entry.char);
}

describe('GET /api/chain/chars', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('keeps a second-tone reading', () => {
    // 麻 má is second tone. The old regex dropped it.
    vi.mocked(listChainCharPool).mockResolvedValue([row('麻', 'má')] as never);
    return call().then(({ body }) => {
      expect(charsOf(body)).toEqual(['麻']);
    });
  });

  it('keeps the characters of every tone', () => {
    vi.mocked(listChainCharPool).mockResolvedValue(
      [
        row('妈', 'mā'),
        row('麻', 'má'),
        row('马', 'mǎ'),
        row('骂', 'mà'),
      ] as never,
    );
    return call().then(({ body }) => {
      expect(charsOf(body)).toEqual(['妈', '麻', '马', '骂']);
    });
  });

  it('keeps a ü reading', () => {
    // 绿 lǜ — the old regex had ǜ but not ǖ ǘ ǚ.
    vi.mocked(listChainCharPool).mockResolvedValue([row('绿', 'lǜ'), row('驴', 'lǘ')] as never);
    return call().then(({ body }) => {
      expect(charsOf(body)).toEqual(['绿', '驴']);
    });
  });

  it('keeps every tone mark that carries a tone', () => {
    // All 24 marks, one character each. Every one of them is a tone.
    const marks = [
      ['ā', 1], ['á', 2], ['ǎ', 3], ['à', 4],
      ['ē', 1], ['é', 2], ['ě', 3], ['è', 4],
      ['ī', 1], ['í', 2], ['ǐ', 3], ['ì', 4],
      ['ō', 1], ['ó', 2], ['ǒ', 3], ['ò', 4],
      ['ū', 1], ['ú', 2], ['ǔ', 3], ['ù', 4],
      ['ǖ', 1], ['ǘ', 2], ['ǚ', 3], ['ǜ', 4],
    ] as const;
    vi.mocked(listChainCharPool).mockResolvedValue(
      marks.map(([mark], index) => row(`字${index}`, `m${mark}`)) as never,
    );
    return call().then(({ body }) => {
      expect(charsOf(body)).toHaveLength(24);
    });
  });

  it('reads the tone from the pinyin, not from the row', () => {
    vi.mocked(listChainCharPool).mockResolvedValue([row('麻', 'má')] as never);
    return call().then(({ body }) => {
      expect((body.chars as Array<{ tone: number }>)[0].tone).toBe(2);
    });
  });

  it('drops a neutral reading', () => {
    // 的 de has no tone mark — it is 轻声, which the games cannot use.
    vi.mocked(listChainCharPool).mockResolvedValue([row('的', 'de'), row('好', 'hǎo')] as never);
    return call().then(({ body }) => {
      expect(charsOf(body)).toEqual(['好']);
    });
  });

  it('drops a row with no pinyin', () => {
    vi.mocked(listChainCharPool).mockResolvedValue([row('口', ''), row('好', 'hǎo')] as never);
    return call().then(({ body }) => {
      expect(charsOf(body)).toEqual(['好']);
    });
  });

  it('says the pool failed when the query throws', async () => {
    vi.mocked(listChainCharPool).mockRejectedValue(new Error('the database is down'));
    const { body } = await call();
    expect(body.chars).toEqual([]);
    expect(body.failed).toBe(true);
  });

  it('says the pool did not fail when it succeeds', async () => {
    vi.mocked(listChainCharPool).mockResolvedValue([row('好', 'hǎo')] as never);
    const { body } = await call();
    expect(body.failed).toBe(false);
  });
});
