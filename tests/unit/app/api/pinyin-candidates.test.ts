// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * The candidate list a learner picks a character from.
 *
 * The bug this file pins: `data/pinyin-hanzi.json` drops the tone and ranks
 * by phrase-list counts, so typing `ni` offered 泥 逆 溺 尼 你 — a learner
 * asked for nǐ and was handed 泥 first. The route now prefers the
 * tone-aware table when the input carries a tone digit; plain input keeps
 * the shipped behaviour so nothing that works today breaks.
 */

const { getCandidatesMock, getToneTableMock } = vi.hoisted(() => ({
  getCandidatesMock: vi.fn(),
  getToneTableMock: vi.fn(),
}));

vi.mock('@/server/dictionary', () => ({
  getCandidates: getCandidatesMock,
}));

vi.mock('@/lib/pinyin-tone-data', () => ({
  getToneTable: getToneTableMock,
}));

vi.mock('@/lib/pinyin-tone-decode', () => ({
  syllableKeyOf: (syllable: string) => syllable,
  splitTonedSyllables: (input: string) =>
    input
      .toLowerCase()
      .replace(/[^a-z1-5v]/g, '')
      .match(/([a-z]+)([1-5])?/g)
      ?.map((piece) => {
        const match = piece.match(/([a-z]+)([1-5])?/);
        return match ? match[1] + (match[2] ?? '5') : '';
      })
      .filter(Boolean) ?? [],
}));

import { GET } from '@/app/api/pinyin/candidates/route';

/** Build a request the way the browser does. */
function request(query: string): NextRequest {
  return new NextRequest(`http://localhost/api/pinyin/candidates?${query}`);
}

beforeEach(() => {
  getCandidatesMock.mockReset();
  getToneTableMock.mockReset();
  getCandidatesMock.mockReturnValue([]);
  getToneTableMock.mockReturnValue({});
});

describe('GET /api/pinyin/candidates', () => {
  it('rejects a request with no pinyin', async () => {
    const res = await GET(request(''));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.code).toBe('missing_pinyin');
  });

  it('serves the shipped candidates for plain pinyin', async () => {
    getCandidatesMock.mockReturnValue([{ char: '泥', freq: 109 }]);
    const res = await GET(request('pinyin=ni&safeMode=false&script=simplified'));
    const body = await res.json();
    expect(getCandidatesMock).toHaveBeenCalledWith('ni', false, 'simplified');
    expect(body.data.candidates[0].char).toBe('泥');
  });

  it('prefers the tone-aware table when the input carries a tone', async () => {
    // The learner typed nǐ: the answer is 你, not 泥.
    getToneTableMock.mockReturnValue({
      ni3: [
        { char: '你', freq: 234587 },
        { char: '拟', freq: 1919 },
      ],
    });
    const res = await GET(request('pinyin=ni3&safeMode=false&script=simplified'));
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.candidates[0].char).toBe('你');
    // The shipped dictionary must not be consulted at all — its ranking is
    // the bug this route exists to bypass.
    expect(getCandidatesMock).not.toHaveBeenCalled();
  });

  it('falls back to the shipped dictionary when the toned syllable is unknown', async () => {
    // A syllable the tone table has never seen must not yield an empty
    // list: the shipped dictionary may still know it.
    getToneTableMock.mockReturnValue({});
    getCandidatesMock.mockReturnValue([{ char: '甲', freq: 5 }]);
    const res = await GET(request('pinyin=jia3&safeMode=false&script=simplified'));
    const body = await res.json();
    expect(body.data.candidates[0].char).toBe('甲');
  });

  it('returns the whole toned bucket, not just the first entry', async () => {
    getToneTableMock.mockReturnValue({
      shi4: [
        { char: '是', freq: 796991 },
        { char: '事', freq: 44769 },
        { char: '市', freq: 40141 },
      ],
    });
    const res = await GET(request('pinyin=shi4&safeMode=false&script=simplified'));
    const body = await res.json();
    expect(body.data.candidates.map((c: { char: string }) => c.char)).toEqual(['是', '事', '市']);
  });
});
