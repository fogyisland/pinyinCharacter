/**
 * One-time migration: drop LLM-generated content columns from the DB.
 *
 * Schema after this migration:
 *   chars:            char, level, pinyin, radical, stroke_count, unicode_codepoint
 *   char_etymology:   char + 5 era_*_font + 5 era_*_has (no story/generated_*)
 *   char_story:       DROPPED ENTIRELY
 *   rare_chars:       char, pinyin, needs_review (no meaning/story/generated_*)
 *
 * All content lives in data/content/<char>.json after this point. The
 * writer paths (lib/admin-char-gen.ts, scripts/content-sync.ts) already
 * write to JSON; legacy scripts (write-char-meanings, write-stories,
 * fetch-rare-chars) will FAIL after migration — update them to write
 * JSON first if you still need them.
 *
 * Safety:
 *   - Refuses to run unless --yes-i-know-what-im-doing is passed
 *   - Runs scripts/export-content.ts --verify first to confirm JSON has
 *     all the data the DB is about to lose
 *   - Wraps the ALTERs in a try/catch so partial failures are reported
 *
 * Run: pnpm tsx --env-file=.env scripts/migrate-drop-content-cols.ts --yes-i-know-what-im-doing
 *      [--dry-run]   show the SQL without executing
 *      [--skip-export-check]  skip the export-content verification (DANGEROUS)
 */
import { getPool, closePool } from '../lib/db';

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    confirmed: args.includes('--yes-i-know-what-im-doing'),
    dryRun: args.includes('--dry-run'),
    skipExportCheck: args.includes('--skip-export-check'),
  };
}

async function verifyExport() {
  console.log('[migrate] Step 1/2: verifying data/content/ has all DB content...');
  const { exportContent } = await import('./export-content');
  const stats = await exportContent({ dryRun: true });
  console.log(
    `[migrate] export dry-run: scanned=${stats.scanned} written=${stats.written} ` +
    `skipped=${stats.skipped} errors=${stats.errors.length}`,
  );
  if (stats.errors.length > 0) {
    for (const e of stats.errors.slice(0, 5)) {
      console.error(`  ${e.char}: ${e.error}`);
    }
    throw new Error(
      `export-content reported ${stats.errors.length} errors — fix before dropping DB cols`,
    );
  }
  if (stats.written === 0) {
    throw new Error(
      'export-content would write 0 files — DB may already be empty or JSON already has everything. ' +
      'Refusing to drop columns without a positive write count.',
    );
  }
  console.log(`[migrate] ✓ export dry-run wrote ${stats.written} files (would update manifest)`);
}

async function checkColumnExists(pool: any, table: string, column: string): Promise<boolean> {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS n FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
    [table, column],
  );
  return Number((rows as any[])[0]?.n ?? 0) > 0;
}

async function checkTableExists(pool: any, table: string): Promise<boolean> {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS n FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = ?`,
    [table],
  );
  return Number((rows as any[])[0]?.n ?? 0) > 0;
}

const DROPS: Array<{ table: string; column: string }> = [
  { table: 'chars', column: 'pinyin_alt' },
  { table: 'chars', column: 'meaning_zh' },
  { table: 'chars', column: 'meaning_en' },
  { table: 'chars', column: 'variants' },
  { table: 'chars', column: 'created_at' },
  { table: 'chars', column: 'updated_at' },
  { table: 'char_etymology', column: 'story' },
  { table: 'char_etymology', column: 'generated_by' },
  { table: 'char_etymology', column: 'generated_at' },
  { table: 'char_etymology', column: 'created_at' },
  { table: 'char_etymology', column: 'updated_at' },
  { table: 'rare_chars', column: 'meaning' },
  { table: 'rare_chars', column: 'story' },
  { table: 'rare_chars', column: 'generated_by' },
  { table: 'rare_chars', column: 'generated_at' },
  { table: 'rare_chars', column: 'created_at' },
];

const DROP_TABLES = ['char_story'];

async function main() {
  const opts = parseArgs();
  if (!opts.confirmed) {
    console.error('REFUSING TO RUN without --yes-i-know-what-im-doing');
    console.error('This migration drops LLM content columns. All content must be in data/content/ first.');
    console.error('Run scripts/export-content.ts first to verify, then re-run with the flag.');
    process.exit(1);
  }

  if (!opts.skipExportCheck) {
    await verifyExport();
  } else {
    console.warn('[migrate] WARNING: --skip-export-check set, not verifying export. THIS IS RISKY.');
  }

  const pool = getPool();

  console.log('[migrate] Step 2/2: dropping columns + table...');
  let dropped = 0;
  let skipped = 0;

  for (const { table, column } of DROPS) {
    if (!(await checkTableExists(pool, table))) {
      console.log(`  [skip] ${table} doesn't exist`);
      skipped++;
      continue;
    }
    if (!(await checkColumnExists(pool, table, column))) {
      console.log(`  [skip] ${table}.${column} already dropped`);
      skipped++;
      continue;
    }
    const sql = `ALTER TABLE \`${table}\` DROP COLUMN \`${column}\``;
    if (opts.dryRun) {
      console.log(`  [dry-run] ${sql}`);
      dropped++;
      continue;
    }
    try {
      await pool.query(sql);
      console.log(`  [drop] ${table}.${column}`);
      dropped++;
    } catch (err) {
      console.error(`  [FAIL] ${table}.${column}: ${(err as Error).message}`);
      throw err;
    }
  }

  for (const table of DROP_TABLES) {
    if (!(await checkTableExists(pool, table))) {
      console.log(`  [skip] table ${table} doesn't exist`);
      skipped++;
      continue;
    }
    const sql = `DROP TABLE \`${table}\``;
    if (opts.dryRun) {
      console.log(`  [dry-run] ${sql}`);
      dropped++;
      continue;
    }
    try {
      await pool.query(sql);
      console.log(`  [drop] TABLE ${table}`);
      dropped++;
    } catch (err) {
      console.error(`  [FAIL] TABLE ${table}: ${(err as Error).message}`);
      throw err;
    }
  }

  console.log(`[migrate] done: dropped=${dropped} skipped=${skipped} dryRun=${opts.dryRun}`);
  if (!opts.dryRun) {
    console.log('[migrate] ✓ migration complete. DB is now slim (structural cols only).');
    console.log('[migrate] Next: re-run scripts/init-db.ts to update DDL in source.');
  }

  await closePool();
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[migrate] failed:', err);
    process.exit(1);
  });
}