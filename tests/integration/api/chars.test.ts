import { integrationDescribe, installTestEnv, truncateAll } from '../setup';
import { getPool } from '@/lib/db';
import { NextRequest } from 'next/server';

installTestEnv();
integrationDescribe('GET /api/chars', () => {
  beforeEach(async () => {
    await truncateAll();
    const pool = getPool();
    await pool.execute(
      `INSERT INTO \`chars\` (\`char\`, level, pinyin, radical, stroke_count, unicode_codepoint) VALUES (?, ?, ?, ?, ?, ?)`,
      ['一', 1, 'yī', '一', 1, 'U+4E00']
    );
    await pool.execute(
      `INSERT INTO \`chars\` (\`char\`, level, pinyin, radical, stroke_count, unicode_codepoint) VALUES (?, ?, ?, ?, ?, ?)`,
      ['丁', 1, 'dīng', '一', 2, 'U+4E01']
    );
  });

  it('200 returns list of chars', async () => {
    if (!process.env.DATABASE_URL_TEST) return;
    const { GET } = await import('@/app/api/chars/route');
    const r = await GET(new NextRequest('http://x/api/chars') as any);
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.ok).toBe(true);
    expect(j.data.total).toBe(2);
  });

  it('400 on invalid level', async () => {
    if (!process.env.DATABASE_URL_TEST) return;
    const { GET } = await import('@/app/api/chars/route');
    const r = await GET(new NextRequest('http://x/api/chars?level=99') as any);
    expect(r.status).toBe(400);
  });

  it('filters by letter', async () => {
    if (!process.env.DATABASE_URL_TEST) return;
    const { GET } = await import('@/app/api/chars/route');
    const r = await GET(new NextRequest('http://x/api/chars?letter=Y') as any);
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.data.chars.map((c: any) => c.char)).toEqual(['一']);
  });
});
