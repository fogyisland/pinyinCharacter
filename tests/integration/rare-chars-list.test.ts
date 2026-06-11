import { beforeAll } from 'vitest';
import { integrationDescribe, installTestEnv } from './setup';
import { getPool } from '@/lib/db';

installTestEnv();
beforeAll(async () => {
  if (!process.env.DATABASE_URL_TEST) return;
  process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
  const { initDb } = await import('@/scripts/init-db');
  await initDb();
});

const { GET } = await import('@/app/api/rare-chars/route');

function makeReq(qs: string) {
  return new Request(`http://x/api/rare-chars${qs}`, { method: 'GET' }) as any;
}

integrationDescribe('GET /api/rare-chars (integration)', () => {
  it('returns all chars when no query', async () => {
    const pool = getPool();
    await pool.execute(`TRUNCATE TABLE rare_chars`);
    await pool.execute(
      `INSERT INTO rare_chars (char, pinyin, meaning, story) VALUES
       ('龘','dá','古龙','龙行龘龘'),
       ('齉','nàng','鼻音','鼻子齉了'),
       ('你','ni','代词','你叫什么')`
    );
    const r = await GET(makeReq(''));
    const j = await r.json();
    expect(r.status).toBe(200);
    expect(j.ok).toBe(true);
    expect(j.data.total).toBe(3);
  });

  it('filters by exact char', async () => {
    const r = await GET(makeReq('?q=%E9%BE%98'));
    const j = await r.json();
    expect(r.status).toBe(200);
    expect(j.data.total).toBe(1);
    expect(j.data.chars[0].char).toBe('龘');
  });

  it('filters by pinyin substring', async () => {
    const r = await GET(makeReq('?q=ni'));
    const j = await r.json();
    expect(r.status).toBe(200);
    expect(j.data.total).toBe(1);
    expect(j.data.chars[0].char).toBe('你');
  });

  it('rejects q > 32 chars', async () => {
    const r = await GET(makeReq(`?q=${'a'.repeat(33)}`));
    expect(r.status).toBe(400);
  });
});
