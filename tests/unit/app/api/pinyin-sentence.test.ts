// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * The sentence converter route.
 *
 * The shipped converter scores 2/10 on a teacher's sample sentences (it
 * offered 泥 for nǐ). When the input carries tones, the route now answers
 * from the tone-aware decoder instead; plain input keeps the old converter
 * so nothing that works today changes.
 */

const { convertSentenceMock, convertTonedMock, getToneTableMock, getBigramsMock } = vi.hoisted(() => ({
  convertSentenceMock: vi.fn(),
  convertTonedMock: vi.fn(),
  getToneTableMock: vi.fn(),
  getBigramsMock: vi.fn(),
}));

vi.mock('@/server/sentence-converter', () => ({
  convertSentence: convertSentenceMock,
}));

vi.mock('@/lib/pinyin-tone-data', () => ({
  getToneTable: getToneTableMock,
  getBigrams: getBigramsMock,
}));

vi.mock('@/lib/pinyin-tone-decode', async () => {
  const actual = await vi.importActual<typeof import('@/lib/pinyin-tone-decode')>('@/lib/pinyin-tone-decode');
  return {
    ...actual,
    convertToned: convertTonedMock,
  };
});

import { GET } from '@/app/api/pinyin/sentence/route';

function request(query: string): NextRequest {
  return new NextRequest(`http://localhost/api/pinyin/sentence?${query}`);
}

beforeEach(() => {
  convertSentenceMock.mockReset();
  convertTonedMock.mockReset();
  getToneTableMock.mockReset();
  getBigramsMock.mockReset();
  convertSentenceMock.mockReturnValue('卧石老师');
  getToneTableMock.mockReturnValue({});
  getBigramsMock.mockReturnValue({});
  convertTonedMock.mockReturnValue('');
});

describe('GET /api/pinyin/sentence', () => {
  it('rejects a request with no pinyin', async () => {
    const res = await GET(request(''));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('missing_pinyin');
  });

  it('serves the shipped converter for plain pinyin', async () => {
    const res = await GET(request('pinyin=nihao&safeMode=false&script=simplified'));
    const body = await res.json();
    expect(convertSentenceMock).toHaveBeenCalledWith('nihao', false, 'simplified');
    expect(body.data.sentence).toBe('卧石老师');
  });

  it('uses the tone-aware decoder when the input carries tones', async () => {
    convertTonedMock.mockReturnValue('我是老师');
    const res = await GET(request('pinyin=wo3shi4lao3shi1&safeMode=false&script=simplified'));
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.sentence).toBe('我是老师');
    // The old converter must not decide this sentence: its ranking is the
    // reason the tone-aware path exists.
    expect(convertSentenceMock).not.toHaveBeenCalled();
  });

  it('falls back to the shipped converter when the toned decode finds nothing', async () => {
    // A tone-aware decode that cannot resolve a syllable returns ''; the
    // old converter may still produce something usable, and an empty
    // answer would look like a broken tool.
    convertTonedMock.mockReturnValue('');
    const res = await GET(request('pinyin=wo3shi4lao3shi1&safeMode=false&script=simplified'));
    const body = await res.json();
    expect(body.data.sentence).toBe('卧石老师');
    expect(convertSentenceMock).toHaveBeenCalled();
  });

  it('reports which engine answered', async () => {
    convertTonedMock.mockReturnValue('我是老师');
    const first = await GET(request('pinyin=wo3shi4lao3shi1&safeMode=false&script=simplified'));
    const toned = await first.json();
    expect(toned.data.engine).toBe('tone-aware');
    const second = await GET(request('pinyin=nihao&safeMode=false&script=simplified'));
    const plain = await second.json();
    expect(plain.data.engine).toBe('classic');
  });
});
