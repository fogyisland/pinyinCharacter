/**
 * GET /api/idioms — the questions the idiom drag game draws from.
 *
 * The route reads the `idioms` table. It filters by difficulty level and
 * caps how many rows it hands back, because the game asks for one question
 * at a time and a table scan of every idiom on every request would be
 * wasteful.
 *
 * A missing table is a real state, not a crash: the migration that creates
 * `idioms` may not have run yet on a fresh database, and the game has to be
 * able to say "no idioms yet" rather than take the whole page down. So the
 * route answers HTTP 200 with `failed: true` and an empty list, the same
 * way `/api/chain/chars` does.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));

vi.mock('@/lib/idioms', () => ({
  listIdioms: vi.fn(),
}));

import { listIdioms } from '@/lib/idioms';
import { GET } from '@/app/api/idioms/route';

/** One idiom row, in the shape `listIdioms` returns. */
function row(word: string, pinyin: string, level = 1, category = '品格') {
  return { word, pinyin, meaning: `${word}的意思。`, level, category };
}

/** Calls the route with a query string. */
async function call(query = ''): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await GET(new NextRequest(`http://localhost/api/idioms${query}`));
  return { status: response.status, body: await response.json() };
}

/** The idioms a response holds. */
function idiomsOf(body: Record<string, unknown>): Array<{ word: string }> {
  return (body.idioms as Array<{ word: string }>) ?? [];
}

describe('GET /api/idioms', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('returns the idioms', async () => {
    vi.mocked(listIdioms).mockResolvedValue([row('一帆风顺', 'yī fān fēng shùn')] as never);
    const { body } = await call();
    expect(idiomsOf(body).map((i) => i.word)).toEqual(['一帆风顺']);
  });

  it('asks for only the requested level', async () => {
    vi.mocked(listIdioms).mockResolvedValue([row('一帆风顺', 'yī fān fēng shùn')] as never);
    await call('?level=2');
    expect(vi.mocked(listIdioms)).toHaveBeenCalledWith(
      expect.objectContaining({ level: 2 }),
    );
  });

  it('rejects a level outside 1 to 4', async () => {
    const { status } = await call('?level=9');
    expect(status).toBe(400);
  });

  it('rejects a level that is not a number', async () => {
    const { status } = await call('?level=abc');
    expect(status).toBe(400);
  });

  it('asks for the level cap when one is given', async () => {
    // The hard tier uses `maxLevel=4` rather than `level=4`, so that it
    // draws from every band instead of only the literary one. A filter that
    // was not passed through would silently return the whole table.
    vi.mocked(listIdioms).mockResolvedValue([] as never);
    await call('?maxLevel=4');
    expect(vi.mocked(listIdioms)).toHaveBeenCalledWith(
      expect.objectContaining({ maxLevel: 4 }),
    );
  });

  it('rejects a level cap outside 1 to 4', async () => {
    expect((await call('?maxLevel=0')).status).toBe(400);
    expect((await call('?maxLevel=9')).status).toBe(400);
  });

  it('asks for no level cap when none is given', async () => {
    vi.mocked(listIdioms).mockResolvedValue([] as never);
    await call();
    expect(vi.mocked(listIdioms)).toHaveBeenCalledWith(
      expect.objectContaining({ maxLevel: undefined }),
    );
  });

  it('asks for every level when none is given', async () => {
    vi.mocked(listIdioms).mockResolvedValue([] as never);
    await call();
    expect(vi.mocked(listIdioms)).toHaveBeenCalledWith(
      expect.objectContaining({ level: undefined }),
    );
  });

  it('caps how many rows it asks for', async () => {
    vi.mocked(listIdioms).mockResolvedValue([] as never);
    await call('?limit=5');
    expect(vi.mocked(listIdioms)).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 5 }),
    );
  });

  it('rejects a limit that is not a positive number', async () => {
    expect((await call('?limit=0')).status).toBe(400);
    expect((await call('?limit=-3')).status).toBe(400);
  });

  it('answers 200 with an empty list when the table is missing', async () => {
    vi.mocked(listIdioms).mockRejectedValue(new Error("Table 'idioms' doesn't exist"));
    const { status, body } = await call();
    expect(status).toBe(200);
    expect(idiomsOf(body)).toEqual([]);
    expect(body.failed).toBe(true);
  });

  it('says the query did not fail when it succeeds', async () => {
    vi.mocked(listIdioms).mockResolvedValue([row('一帆风顺', 'yī fān fēng shùn')] as never);
    const { body } = await call();
    expect(body.failed).toBe(false);
  });

  it('tells the client not to cache the answer', async () => {
    vi.mocked(listIdioms).mockResolvedValue([] as never);
    const response = await GET(new NextRequest('http://localhost/api/idioms'));
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
});
