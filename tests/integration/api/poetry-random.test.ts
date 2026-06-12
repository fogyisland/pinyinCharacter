import { integrationDescribe, installTestEnv } from '../setup';
import { getPool } from '@/lib/db';

installTestEnv();
integrationDescribe('GET /api/poetry/random (integration)', () => {
  it('returns 404 when empty', async () => {
    if (!process.env.DATABASE_URL_TEST) return;
    const pool = getPool();
    await pool.execute('TRUNCATE TABLE poems');
    const { GET } = await import('@/app/api/poetry/random/route');
    const r = await GET();
    expect(r.status).toBe(404);
  });

  it('returns a poem when present', async () => {
    if (!process.env.DATABASE_URL_TEST) return;
    const pool = getPool();
    await pool.execute('TRUNCATE TABLE poems');
    await pool.execute(
      `INSERT INTO poems (dynasty, title, author, content, pinyin) VALUES
       ('tang','静夜思','李白', JSON_ARRAY(), JSON_ARRAY())`
    );
    const { GET } = await import('@/app/api/poetry/random/route');
    const r = await GET();
    const j = await r.json();
    expect(r.status).toBe(200);
    expect(j.data.title).toBe('静夜思');
  });
});
