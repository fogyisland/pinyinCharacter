import { integrationDescribe, installTestEnv, truncateAll } from '../setup';
import { getPool } from '@/lib/db';

installTestEnv();
integrationDescribe('GET /api/etymology/[char]', () => {
  beforeEach(async () => {
    await truncateAll();
    const pool = getPool();
    await pool.execute(
      `INSERT INTO chars (\`char\`, level, pinyin, radical, stroke_count, unicode_codepoint) VALUES ('一', 1, 'yī', '一', 1, 'U+4E00')`
    );
    await pool.execute(
      `INSERT INTO chars (\`char\`, level, pinyin, radical, stroke_count, unicode_codepoint) VALUES ('丁', 1, 'dīng', '一', 2, 'U+4E01')`
    );
    await pool.execute(
      `INSERT INTO chars (\`char\`, level, pinyin, radical, stroke_count, unicode_codepoint) VALUES ('七', 1, 'qī', '一', 2, 'U+4E03')`
    );
    await pool.execute(
      `INSERT INTO char_etymology (\`char\`, era_jiaguwen_has, era_jinwen_has, era_xiaozhuan_has, era_lishu_has, era_kaishu_has, story, generated_by, generated_at)
       VALUES ('一', 1, 1, 1, 1, 1, '一字演变故事', 'gpt-4o', NOW())`
    );
  });

  it('200 returns etymology + prev/next', async () => {
    if (!process.env.DATABASE_URL_TEST) return;
    const { GET } = await import('@/app/api/etymology/[char]/route');
    const r = await GET(new Request('http://x/api/etymology/' + encodeURIComponent('一')) as any, { params: Promise.resolve({ char: '一' }) });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.data.char).toBe('一');
    expect(j.data.story).toBe('一字演变故事');
    expect(j.data.prev).toBe('丁');
    expect(j.data.next).toBe('七');
    expect(j.data.eraGlyphs).toHaveLength(5);
  });

  it('404 when char not in char_etymology', async () => {
    if (!process.env.DATABASE_URL_TEST) return;
    const { GET } = await import('@/app/api/etymology/[char]/route');
    const r = await GET(new Request('http://x/api/etymology/七') as any, { params: Promise.resolve({ char: '七' }) });
    expect(r.status).toBe(404);
  });
});