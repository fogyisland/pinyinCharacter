import { installTestEnv, integrationDescribe } from '../setup';
import { getPool, closePool } from '@/lib/db';
import { initDb } from '@/scripts/init-db';

installTestEnv();
integrationDescribe('chars table DDL', () => {
  beforeAll(async () => {
    await initDb();
  });
  afterAll(async () => {
    await closePool();
  });
  it('creates chars table with at least 11 columns', async () => {
    const pool = getPool();
    const [rows] = await pool.query<any[]>(
      `SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'chars'`
    );
    expect(rows[0].n).toBeGreaterThanOrEqual(11);
  });
  it('char column is PRIMARY KEY', async () => {
    const pool = getPool();
    const [rows] = await pool.query<any[]>(
      `SELECT COLUMN_KEY FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'chars' AND column_name = 'char'`
    );
    expect(rows[0].COLUMN_KEY).toBe('PRI');
  });
});