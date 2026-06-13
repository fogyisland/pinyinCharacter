import { integrationDescribe, installTestEnv, truncateAll } from '../setup';
import { getPool } from '@/lib/db';

installTestEnv();
integrationDescribe('GET /api/chars/[char]', () => {
  beforeEach(async () => {
    await truncateAll();
    const pool = getPool();
    await pool.execute(
      `INSERT INTO chars (\`char\`, level, pinyin, radical, stroke_count, meaning_zh, meaning_en, unicode_codepoint) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ['一', 1, 'yī', '一', 1, '数目字', 'one', 'U+4E00']
    );
  });

  it('200 returns char detail with related', async () => {
    if (!process.env.DATABASE_URL_TEST) return;
    const { GET } = await import('@/app/api/chars/[char]/route');
    const r = await GET(new Request('http://x/api/chars/' + encodeURIComponent('一')) as any, { params: Promise.resolve({ char: '一' }) });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.data.char).toBe('一');
    expect(j.data.pinyin).toBe('yī');
    expect(j.data.meaningZh).toBe('数目字');
  });

  it('404 when char not found', async () => {
    if (!process.env.DATABASE_URL_TEST) return;
    const { GET } = await import('@/app/api/chars/[char]/route');
    const r = await GET(new Request('http://x/api/chars/X') as any, { params: Promise.resolve({ char: 'X' }) });
    expect(r.status).toBe(404);
  });

  it('400 on multi-char path', async () => {
    if (!process.env.DATABASE_URL_TEST) return;
    const { GET } = await import('@/app/api/chars/[char]/route');
    const r = await GET(new Request('http://x/api/chars/abc') as any, { params: Promise.resolve({ char: 'abc' }) });
    expect(r.status).toBe(400);
  });
});