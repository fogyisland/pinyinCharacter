import { beforeAll } from 'vitest';
import { integrationDescribe, installTestEnv } from '../setup';
import { getPool } from '@/lib/db';

installTestEnv();
beforeAll(async () => {
  if (!process.env.DATABASE_URL_TEST) return;
  process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
  const { initDb } = await import('@/scripts/init-db');
  await initDb();
});

integrationDescribe('initDb char_story', () => {
  it('creates char_story table with expected columns', async () => {
    const pool = getPool();
    const [rows] = await pool.query<any[]>(
      `SELECT COLUMN_NAME, DATA_TYPE FROM information_schema.columns
       WHERE table_schema = DATABASE() AND table_name = 'char_story'
       ORDER BY ORDINAL_POSITION`
    );
    const cols = rows.map(r => r.COLUMN_NAME);
    expect(cols).toContain('char');
    expect(cols).toContain('story');
    expect(cols).toContain('generated_by');
    expect(cols).toContain('generated_at');
  });
});