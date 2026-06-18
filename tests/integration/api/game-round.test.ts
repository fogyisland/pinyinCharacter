import { integrationDescribe, installTestEnv } from '../setup';
import { getPool } from '@/lib/db';

installTestEnv();
integrationDescribe('GET /api/game/round (integration)', () => {
  it('returns 4 chars with tone + radical answers when DB has data', async () => {
    if (!process.env.DATABASE_URL_TEST) return;
    const pool = getPool();
    await pool.execute('TRUNCATE TABLE rare_chars');
    await pool.execute(
      `INSERT INTO rare_chars (\`char\`, pinyin, meaning, story, needs_review) VALUES
       ('妈','mā','mother','', false),
       ('你','nǐ','you','', false),
       ('好','hǎo','good','', false),
       ('河','hé','river','', false),
       ('花','huā','flower','', false),
       ('草','cǎo','grass','', false)`
    );
    const { GET } = await import('@/app/api/game/round/route');
    const req = new Request('http://localhost/api/game/round?count=4');
    const r = await GET(req as any);
    const j = await r.json();
    expect(r.status).toBe(200);
    expect(j.ok).toBe(true);
    expect(j.data.chars).toHaveLength(4);
    for (const c of j.data.chars) {
      expect(c.char).toMatch(/^[一-鿿]$/);
      expect(typeof c.pinyin).toBe('string');
      expect(typeof j.data.charToAnswer[c.char].tone).toBe('number');
      expect(typeof j.data.charToAnswer[c.char].radical).toBe('string');
    }
    // tone choices cover 1-4 (no neutral — neutral/轻声 is filtered out)
    expect(j.data.toneChoices).toEqual([1, 2, 3, 4]);
  });

  it('returns 503 when no chars have radicals in JSON', async () => {
    if (!process.env.DATABASE_URL_TEST) return;
    const pool = getPool();
    await pool.execute('TRUNCATE TABLE rare_chars');
    // 龘 is a CJK char unlikely to be in radicals.json
    await pool.execute(
      `INSERT INTO rare_chars (\`char\`, pinyin, meaning, story, needs_review) VALUES
       ('龘','dá','rare','', false)`
    );
    const { GET } = await import('@/app/api/game/round/route');
    const r = await GET(new Request('http://localhost/api/game/round') as any);
    expect(r.status).toBe(503);
  });
});