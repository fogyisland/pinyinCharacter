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
import { getPool, closePool } from '../lib/db';

const MIGRATIONS_DIR = join(process.cwd(), 'scripts', 'migrations');

function splitStatements(sql: string): string[] {
  // Naive splitter: split on `;` at end of line, drop empty/comment-only chunks.
  // Migrations are written without stored procedures / DELIMITER tricks, so
  // a single split is enough. If we ever need DELIMITER, replace with a real
  // SQL parser.
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.match(/^\s*--/));
}

export async function runMigrations(): Promise<{ files: number; statements: number }> {
  const pool = getPool();
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();  // lexical = chronological given YYYY-MM-DD- prefix
  let statements = 0;
  for (const file of files) {
    const fullPath = join(MIGRATIONS_DIR, file);
    const sql = readFileSync(fullPath, 'utf8');
    const stmts = splitStatements(sql);
    for (const stmt of stmts) {
      await pool.query(stmt);
      statements++;
    }
    console.log(`[migrate] applied ${file} (${stmts.length} statements)`);
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