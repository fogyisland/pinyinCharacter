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
  const chars = Array.from({ length: 50 }, (_, i) => String.fromCodePoint(0x4e00 + i));
  for (const c of chars) {
    await pool.execute(
      `INSERT INTO rare_chars (char, pinyin, meaning, story) VALUES (?, 'a', 'm', 's')`,
      [c]
    );
  }
});

const { GET } = await import('@/app/api/rare-chars/daily/route');

function makeReq(qs: string) {
  return new Request(`http://x/api/rare-chars/daily${qs}`, { method: 'GET' }) as any;
}

integrationDescribe('GET /api/rare-chars/daily (integration)', () => {
  it('returns a char for the given date', async () => {
    const r = await GET(makeReq('?date=2026-06-11'));
    const j = await r.json();
    expect(r.status).toBe(200);
    expect(j.data.char).toBeTruthy();
    expect(j.data.date).toBe('2026-06-11');
  });

  it('same date returns same char (deterministic)', async () => {
    const a = await GET(makeReq('?date=2026-06-11'));
    const b = await GET(makeReq('?date=2026-06-11'));
    const ja = await a.json();
    const jb = await b.json();
    expect(ja.data.char).toBe(jb.data.char);
  });

  it('different dates often return different chars', async () => {
    const set = new Set<string>();
    for (let d = 1; d <= 30; d++) {
      const date = `2026-06-${String(d).padStart(2, '0')}`;
      const r = await GET(makeReq(`?date=${date}`));
      const j = await r.json();
      set.add(j.data.char);
    }
    expect(set.size).toBeGreaterThanOrEqual(5);
  });

  it('defaults to today if no date', async () => {
    const r = await GET(makeReq(''));
    const j = await r.json();
    expect(r.status).toBe(200);
    expect(j.data.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
