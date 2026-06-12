import { integrationDescribe, installTestEnv } from '../setup';
import { getPool } from '@/lib/db';

installTestEnv();
integrationDescribe('GET /api/poetry (integration)', () => {
  it('returns empty list when no poems', async () => {
    if (!process.env.DATABASE_URL_TEST) return;
    const pool = getPool();
    await pool.execute('TRUNCATE TABLE poems');
    const { GET } = await import('@/app/api/poetry/route');
    const r = await GET(new Request('http://x/api/poetry?dynasty=tang') as any);
    const j = await r.json();
    expect(r.status).toBe(200);
    expect(j.ok).toBe(true);
    expect(j.data.items).toEqual([]);
    expect(j.data.total).toBe(0);
  });

  it('filters by dynasty', async () => {
    if (!process.env.DATABASE_URL_TEST) return;
    const pool = getPool();
    await pool.execute('TRUNCATE TABLE poems');
    await pool.execute(
      `INSERT INTO poems (dynasty, title, author, content, pinyin) VALUES
       ('tang','静夜思','李白', JSON_ARRAY('床前明月光'), JSON_ARRAY(JSON_ARRAY('chuáng'))),
       ('tang','春晓','孟浩然', JSON_ARRAY('春眠不觉晓'), JSON_ARRAY(JSON_ARRAY('chūn'))),
       ('song','如梦令','李清照', JSON_ARRAY('昨夜雨疏风骤'), JSON_ARRAY(JSON_ARRAY('zuó')))`
    );
    const { GET } = await import('@/app/api/poetry/route');
    const r = await GET(new Request('http://x/api/poetry?dynasty=song') as any);
    const j = await r.json();
    expect(j.data.items).toHaveLength(1);
    expect(j.data.items[0].author).toBe('李清照');
  });

  it('searches by title', async () => {
    if (!process.env.DATABASE_URL_TEST) return;
    const pool = getPool();
    await pool.execute('TRUNCATE TABLE poems');
    await pool.execute(
      `INSERT INTO poems (dynasty, title, author, content, pinyin) VALUES
       ('tang','静夜思','李白', JSON_ARRAY(), JSON_ARRAY()),
       ('tang','春晓','孟浩然', JSON_ARRAY(), JSON_ARRAY())`
    );
    const { GET } = await import('@/app/api/poetry/route');
    const r = await GET(new Request('http://x/api/poetry?dynasty=tang&q=静夜') as any);
    const j = await r.json();
    expect(j.data.total).toBe(1);
    expect(j.data.items[0].title).toBe('静夜思');
  });

  it('rejects unknown dynasty', async () => {
    const { GET } = await import('@/app/api/poetry/route');
    const r = await GET(new Request('http://x/api/poetry?dynasty=yuan') as any);
    expect(r.status).toBe(400);
  });
});
