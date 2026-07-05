/**
 * Apply all SQL migrations in scripts/migrations/ in lexical order.
 *
 * Each migration file is idempotent (MODIFY COLUMN / CREATE IF NOT EXISTS /
 * ALTER TABLE with conditional checks), so re-running is safe — every
 * statement is a no-op once the schema is current.
 *
 * Called by /api/init/run-seed before initDb() so /init step 3 leaves the
 * schema in sync with the code, regardless of when the DB was first created.
 * Also runnable directly via `npx tsx scripts/migrate.ts` for operator use.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import mysql from 'mysql2/promise';
import { closePool } from '../lib/db';

const MIGRATIONS_DIR = join(process.cwd(), 'scripts', 'migrations');

export async function runMigrations(): Promise<{ files: number; statements: number }> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();  // lexical = chronological given YYYY-MM-DD- prefix

  // Separate connection with multipleStatements — the shared pool only accepts
  // single-statement queries (default). PREPARE/EXECUTE/DEALLOCATE blocks in
  // 2026-06-27-email-{campaigns,verification}.sql put all 3 statements on one
  // line; the naive splitter concatenated them and mysql rejected the result.
  // Multi-statement is safe here because migration files are operator-controlled.
  const conn = await mysql.createConnection({
    uri: process.env.DATABASE_URL,
    multipleStatements: true,
  });

  let statements = 0;
  try {
    for (const file of files) {
      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
      const [results] = await conn.query(sql);
      const count = Array.isArray(results) ? results.length : 1;
      statements += count;
      console.log(`[migrate] applied ${file} (${count} statements)`);
    }
  } finally {
    await conn.end();
  }
  return { files: files.length, statements };
}

if (require.main === module) {
  runMigrations()
    .then((r) => {
      console.log(`[migrate] done: ${r.files} files, ${r.statements} statements`);
      return closePool();
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}