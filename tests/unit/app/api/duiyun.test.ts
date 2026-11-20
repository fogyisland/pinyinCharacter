/**
 * GET /api/duiyun — the couplets the 对韵消消 game draws from.
 *
 * The route reads `data/duiyun-pairs.json`, a file in the repository, not a
 * table. The data file missing is a real state — a fresh clone that has not
 * run the extraction script has no couplets — so the route answers HTTP 200
 * with `failed: true` and an empty list rather than taking the page down.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));

vi.mock('@/lib/duiyun-data', () => ({
  listDuiyunPairs: vi.fn(),
}));

import { listDuiyunPairs } from '@/lib/duiyun-data';
import { GET } from '@/app/api/duiyun/route';

/** Calls the route with a query string. */
async function call(query = ''): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await GET(new NextRequest(`http://localhost/api/duiyun${query}`));
  return { status: response.status, body: await response.json() };
}

/** The pairs a response holds. */
function pairsOf(body: Record<string, unknown>): Array<{ upper: string }> {
  return (body.pairs as Array<{ upper: string }>) ?? [];
}

const PAIR = {
  upper: '天',
  lower: '地',
  upperPinyin: ['tiān'],
  lowerPinyin: ['dì'],
  rhyme: '一东',
  book: '笠翁对韵',
};

describe('GET /api/duiyun', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('returns the pairs', async () => {
    vi.mocked(listDuiyunPairs).mockReturnValue([PAIR] as never);
    const { body } = await call();
    expect(pairsOf(body).map((p) => p.upper)).toEqual(['天']);
  });

  it('caps how many pairs it asks for', async () => {
    vi.mocked(listDuiyunPairs).mockReturnValue([] as never);
    await call('?limit=5');
    expect(vi.mocked(listDuiyunPairs)).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 5 }),
    );
  });

  it('rejects a limit that is not a positive number', async () => {
    expect((await call('?limit=0')).status).toBe(400);
    expect((await call('?limit=-3')).status).toBe(400);
  });

  it('rejects a limit that is not a number', async () => {
    expect((await call('?limit=abc')).status).toBe(400);
  });

  it('answers 200 with an empty list when the data file cannot be read', async () => {
    // 数据文件缺失是一个状态，不是一次请求失败：界面要说「还没有数据」，
    // 而不是整页崩掉。
    vi.mocked(listDuiyunPairs).mockImplementation(() => {
      throw new Error('ENOENT');
    });
    const { status, body } = await call();
    expect(status).toBe(200);
    expect(pairsOf(body)).toEqual([]);
    expect(body.failed).toBe(true);
  });

  it('says the query did not fail when it succeeds', async () => {
    vi.mocked(listDuiyunPairs).mockReturnValue([] as never);
    const { body } = await call();
    expect(body.failed).toBe(false);
  });

  it('tells the client not to cache the answer', async () => {
    vi.mocked(listDuiyunPairs).mockReturnValue([] as never);
    const response = await GET(new NextRequest('http://localhost/api/duiyun'));
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
});
