import { integrationDescribe, installTestEnv, truncateAll } from '../setup';
import { getPool } from '@/lib/db';

installTestEnv();
integrationDescribe('GET /api/stories/random', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('503 when no stories exist', async () => {
    if (!process.env.DATABASE_URL_TEST) return;
    const { GET } = await import('@/app/api/stories/random/route');
    const r = await GET(new Request('http://x/api/stories/random') as any);
    expect(r.status).toBe(503);
    const j = await r.json();
    expect(j.ok).toBe(false);
    expect(j.error?.code).toBe('NO_STORIES');
  });

  it('200 with char/pinyin/meaning/story when stories exist', async () => {
    if (!process.env.DATABASE_URL_TEST) return;
    const pool = getPool();
    await pool.execute(
      `INSERT INTO rare_chars (char, pinyin, meaning, story) VALUES (?, ?, ?, ?)`,
      ['龘', 'dá', '古龙', '从前有一条龙']
    );
    const { GET } = await import('@/app/api/stories/random/route');
    const r = await GET(new Request('http://x/api/stories/random') as any);
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.ok).toBe(true);
    expect(j.data.char).toBe('龘');
    expect(j.data.pinyin).toBe('dá');
    expect(j.data.meaning).toBe('古龙');
    expect(j.data.story).toBe('从前有一条龙');
  });

  it('does not return chars with empty story', async () => {
    if (!process.env.DATABASE_URL_TEST) return;
    const pool = getPool();
    await pool.execute(
      `INSERT INTO rare_chars (char, pinyin, meaning, story) VALUES (?, ?, ?, ?)`,
      ['X', 'x', 'no story', '']
    );
    const { GET } = await import('@/app/api/stories/random/route');
    const r = await GET(new Request('http://x/api/stories/random') as any);
    expect(r.status).toBe(503);
  });
});
