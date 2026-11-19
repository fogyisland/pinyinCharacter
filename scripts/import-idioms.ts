/**
 * Write `data/idioms.json` into the `idioms` table.
 *
 * The importer is idempotent: it upserts on the unique key (`word`), so
 * running it twice leaves the table exactly as the second run found it, and
 * a row whose text changed is updated in place rather than duplicated.
 *
 * It refuses to write anything it did not validate. The rows are written by
 * an AI model, so the file on disk is checked again here — a file that was
 * hand-edited into an invalid state must not reach the database.
 *
 * Rows the importer wrote are not deleted when the file loses one: the
 * operator's rows are never touched, and the seed's "enough counts as
 * seeded" rule means a table with fewer rows than the file simply gets
 * topped up on the next run.
 *
 * Usage:
 *   npx tsx --env-file-if-exists=.env scripts/import-idioms.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RowDataPacket } from 'mysql2';
import { getPool, closePool } from '../lib/db';
import { validateIdiomBatch, type IdiomRow } from '../lib/idiom-data';

const IDIOMS_FILE = join(process.cwd(), 'data', 'idioms.json');

/**
 * The database URL is required — there is no safe default to fall back to.
 * Read it at call time so a caller can set it before invoking the import.
 */
function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'import-idioms: DATABASE_URL is not set. ' +
        'Usage: npx tsx --env-file-if-exists=.env scripts/import-idioms.ts',
    );
  }
  return url;
}

/** Read the file and return the rows that pass validation. */
export function readIdiomRows(path: string = IDIOMS_FILE): IdiomRow[] {
  const raw = readFileSync(path, 'utf8');
  const parsed = JSON.parse(raw) as unknown;
  const { valid, problems } = validateIdiomBatch(parsed);
  if (problems.length > 0) {
    const detail = problems
      .slice(0, 10)
      .map((p) => `${p.word || '(no word)'}: ${p.message}`)
      .join('; ');
    throw new Error(
      `import-idioms: ${path} holds ${problems.length} invalid row(s): ${detail}` +
        (problems.length > 10 ? ` ... and ${problems.length - 10} more` : ''),
    );
  }
  return valid;
}

/**
 * Create the `idioms` table when it is missing.
 *
 * The table also has a migration file (`scripts/migrations/2026-11-19-idioms.sql`),
 * so a deployment that runs `scripts/migrate.ts` never reaches this. This copy
 * exists for the operator who runs the importer alone: the import would
 * otherwise fail on a database that has the schema missing, and the fix would
 * be a second command to remember.
 *
 * `CREATE TABLE IF NOT EXISTS` is idempotent, so this is a no-op once the
 * table exists — it never touches the migration's structure or an existing
 * table's rows.
 */
export async function ensureIdiomsTable(): Promise<void> {
  const pool = getPool();
  await pool.query(
    'CREATE TABLE IF NOT EXISTS idioms (' +
      'id INT UNSIGNED NOT NULL AUTO_INCREMENT,' +
      'word VARCHAR(16) NOT NULL,' +
      'pinyin VARCHAR(64) NOT NULL DEFAULT \'\',' +
      'meaning VARCHAR(512) NOT NULL DEFAULT \'\',' +
      'level TINYINT(4) NOT NULL DEFAULT 1,' +
      'category VARCHAR(32) NOT NULL DEFAULT \'\',' +
      'created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,' +
      'updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,' +
      'PRIMARY KEY (id),' +
      'UNIQUE KEY uk_idioms_word (word),' +
      'KEY idx_idioms_level (level),' +
      'KEY idx_idioms_category (category)' +
      ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci',
  );
}

/** How many idiom rows the table holds. */
export async function countIdioms(): Promise<number> {
  const pool = getPool();
  const [rows] = await pool.query<(RowDataPacket & { n: number })[]>(
    'SELECT COUNT(*) AS n FROM idioms',
  );
  return rows[0] ? Number(rows[0].n) : 0;
}

/**
 * Write the rows.
 *
 * Returns how many rows the table holds afterwards.
 */
export async function importIdioms(rows: readonly IdiomRow[]): Promise<number> {
  const pool = getPool();
  await ensureIdiomsTable();
  for (const row of rows) {
    await pool.query(
      'INSERT INTO idioms (word, pinyin, meaning, level, category) VALUES (?, ?, ?, ?, ?) ' +
        'ON DUPLICATE KEY UPDATE pinyin = VALUES(pinyin), meaning = VALUES(meaning), ' +
        'level = VALUES(level), category = VALUES(category)',
      [row.word, row.pinyin, row.meaning, row.level, row.category],
    );
  }
  return countIdioms();
}

async function main(): Promise<void> {
  requireDatabaseUrl();
  const rows = readIdiomRows();
  console.log(`[import-idioms] ${rows.length} row(s) in ${IDIOMS_FILE}`);
  const total = await importIdioms(rows);
  console.log(`[import-idioms] the idioms table now holds ${total} row(s)`);
}

if (require.main === module) {
  main()
    .then(() => closePool())
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
