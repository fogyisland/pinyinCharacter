import { installTestEnv, integrationDescribe } from '../setup';
import { getPool, closePool } from '@/lib/db';
import { initDb } from '@/scripts/init-db';

installTestEnv();
integrationDescribe('char_etymology table DDL', () => {
  beforeAll(async () => {
    await initDb();
  });
  afterAll(async () => {
    await closePool();
  });
  it('creates char_etymology table with char as PK', async () => {
    const pool = getPool();
    const [rows] = await pool.query<any[]>(
      `SELECT COLUMN_KEY FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'char_etymology' AND column_name = 'char'`
    );
    expect(rows[0].COLUMN_KEY).toBe('PRI');
  });
  it('has 5 era_has boolean columns', async () => {
    const pool = getPool();
    const [rows] = await pool.query<any[]>(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'char_etymology' AND column_name LIKE '%_has'`
    );
    expect(rows).toHaveLength(5);
  });
});
