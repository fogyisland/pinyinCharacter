/**
 * One-time migration: create sutra_copy_progress table.
 * Idempotent: safe to re-run.
 *
 * Run: pnpm tsx --env-file=.env scripts/migrate-sutra-copy-progress.ts
 * After verifying on dev+prod, delete this script (per migrate-membership.ts pattern).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getPool, closePool } from '../lib/db';

async function main() {
  const sql = readFileSync(
    join(__dirname, 'migrations', '2026-06-19-sutra-copy-progress.sql'),
    'utf8'
  );
  // Split on `;` boundary for clean execution (single DDL block, but be safe).
  const pool = getPool();
  for (const stmt of sql.split(/;\s*$/m).map(s => s.trim()).filter(Boolean)) {
    await pool.query(stmt);
  }
  // Confirm by selecting the table.
  const [rows] = await pool.query<any[]>(`SHOW TABLES LIKE 'sutra_copy_progress'`);
  if (rows.length === 0) throw new Error('table not created');
  console.error('[migrate-sutra-copy-progress] table created');
  await closePool();
}

main().catch(err => { console.error(err); process.exit(1); });
