import { getPool } from '../lib/db';

export async function dropPoemsTable(): Promise<void> {
  const pool = getPool();
  await pool.query(`DROP TABLE IF EXISTS poems`);
}

if (require.main === module) {
  dropPoemsTable()
    .then(() => { console.log('[drop-poems-table] poems table dropped'); process.exit(0); })
    .catch(err => { console.error('[drop-poems-table] failed:', err); process.exit(1); });
}