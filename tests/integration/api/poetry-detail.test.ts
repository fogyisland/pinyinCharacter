import { integrationDescribe, installTestEnv } from '../setup';
import { getPool } from '@/lib/db';

installTestEnv();
integrationDescribe('GET /api/poetry/[id] (integration)', () => {
  it('returns 404 for missing id', async () => {
    const { GET } = await import('@/app/api/poetry/[id]/route');
    const r = await GET(new Request('http://x/api/poetry/99999') as any, { params: Promise.resolve({ id: '99999' }) });
    expect(r.status).toBe(404);
  });

  it('returns parsed detail for existing id', async () => {
    if (!process.env.DATABASE_URL_TEST) return;
    const pool = getPool();
    await pool.execute('TRUNCATE TABLE poems');
    await pool.execute(
      `INSERT INTO poems (dynasty, title, author, form, content, pinyin, appreciation) VALUES
       ('tang','静夜思','李白','五言绝句',
        JSON_ARRAY('床前明月光','疑是地上霜'),
        JSON_ARRAY(JSON_ARRAY('chuáng','qián'), JSON_ARRAY('yí','shì')),
        '此诗写秋夜')`
    );
    const [rows] = await pool.execute<any[]>(`SELECT id FROM poems LIMIT 1`);
    const id = (rows as any[])[0].id;
    const { GET } = await import('@/app/api/poetry/[id]/route');
    const r = await GET(new Request(`http://x/api/poetry/${id}`) as any, { params: Promise.resolve({ id: String(id) }) });
    const j = await r.json();
    expect(r.status).toBe(200);
    expect(j.ok).toBe(true);
    expect(j.data.title).toBe('静夜思');
    expect(j.data.content).toEqual(['床前明月光', '疑是地上霜']);
    expect(j.data.pinyin).toEqual([['chuáng', 'qián'], ['yí', 'shì']]);
    expect(j.data.appreciation).toBe('此诗写秋夜');
  });
});
