import { beforeAll } from 'vitest';
import { integrationDescribe, installTestEnv } from './setup';
import { getPool } from '@/lib/db';

installTestEnv();
beforeAll(async () => {
  if (!process.env.DATABASE_URL_TEST) return;
  process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
  const { initDb } = await import('@/scripts/init-db');
  await initDb();
  const pool = getPool();
  await pool.execute(`TRUNCATE TABLE rare_chars`);
  await pool.execute(
    `INSERT INTO rare_chars (char, pinyin, meaning, story) VALUES ('龘','dá','古龙','龙行龘龘')`
  );
});

const { GET } = await import('@/app/api/rare-chars/[char]/route');

function makeReq(path: string) {
  return new Request(`http://x${path}`, { method: 'GET' }) as any;
}

integrationDescribe('GET /api/rare-chars/[char] (integration)', () => {
  it('returns the char when found', async () => {
    const r = await GET(makeReq('/api/rare-chars/%E9%BE%98'), {
      params: Promise.resolve({ char: '%E9%BE%98' }),
    });
    const j = await r.json();
    expect(r.status).toBe(200);
    expect(j.data.char).toBe('龘');
    expect(j.data.pinyin).toBe('dá');
  });

  it('returns 404 for unknown char', async () => {
    const r = await GET(makeReq('/api/rare-chars/%E4%B8%8D'), {
      params: Promise.resolve({ char: '%E4%B8%8D' }),
    });
    expect(r.status).toBe(404);
  });

  it('returns 400 for non-CJK', async () => {
    const r = await GET(makeReq('/api/rare-chars/abc'), {
      params: Promise.resolve({ char: 'abc' }),
    });
    expect(r.status).toBe(400);
  });
});
