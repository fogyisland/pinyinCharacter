import type { Pool } from 'mysql2/promise';
import type { RowDataPacket } from 'mysql2';

/**
 * Which legacy content columns the connected database actually has.
 *
 * Since the 2026-06-17 refactor, character content (meaning / story /
 * etymology / generation provenance) lives in `data/content/<char>.json`.
 * `scripts/init-db.ts` creates the slim schema — no content columns at all —
 * and `scripts/migrate-drop-content-cols.ts` drops them from an install that
 * had the rich one.
 *
 * The DB fallbacks in `lib/content.ts` and `lib/rare-chars.ts` still have to
 * serve a rich install that has not been migrated, so they cannot assume the
 * slim shape. Probing `information_schema` once per pool is cheaper and
 * quieter than firing a doomed query per call and swallowing the error: no
 * query this module guides can name a column the database does not have.
 */
export interface LegacyContentSchema {
  /** Legacy content columns present on `chars`. */
  readonly chars: readonly string[];
  /** Legacy content columns present on `char_etymology`. */
  readonly etymology: readonly string[];
  /** Legacy content columns present on `rare_chars`. */
  readonly rare: readonly string[];
  /** Whether the legacy `char_story` table is still present. */
  readonly hasCharStoryTable: boolean;
}

/** `chars` legacy content columns, in the order the fallback reads them. */
export const LEGACY_CHARS_COLUMNS = [
  'meaning_zh',
  'meaning_en',
  'pinyin_alt',
  'variants',
] as const;

/** `char_etymology` legacy content columns. */
export const LEGACY_ETYMOLOGY_COLUMNS = ['story', 'generated_by', 'generated_at'] as const;

/** `rare_chars` legacy content columns. */
export const LEGACY_RARE_COLUMNS = [
  'meaning',
  'story',
  'generated_by',
  'generated_at',
  'created_at',
] as const;

interface ColumnRow extends RowDataPacket {
  column_name: string;
}

interface TableRow extends RowDataPacket {
  table_name: string;
}

/** One probe per pool — the schema does not change under a live process. */
const schemaCache = new WeakMap<Pool, Promise<LegacyContentSchema>>();

/** The subset of `wanted` that this database actually has on `table`. */
async function listColumns(
  pool: Pool,
  table: string,
  wanted: readonly string[],
): Promise<string[]> {
  const placeholders = wanted.map(() => '?').join(', ');
  const [rows] = await pool.query<ColumnRow[]>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = ?
        AND column_name IN (${placeholders})`,
    [table, ...wanted],
  );
  const present = new Set(rows.map((row) => row.column_name));
  // Keep the caller's order so the generated SELECT is stable.
  return wanted.filter((column) => present.has(column));
}

async function tableExists(pool: Pool, table: string): Promise<boolean> {
  const [rows] = await pool.query<TableRow[]>(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_name = ?`,
    [table],
  );
  return rows.length > 0;
}

async function probe(pool: Pool): Promise<LegacyContentSchema> {
  const [chars, etymology, rare, hasCharStoryTable] = await Promise.all([
    listColumns(pool, 'chars', LEGACY_CHARS_COLUMNS),
    listColumns(pool, 'char_etymology', LEGACY_ETYMOLOGY_COLUMNS),
    listColumns(pool, 'rare_chars', LEGACY_RARE_COLUMNS),
    tableExists(pool, 'char_story'),
  ]);
  return { chars, etymology, rare, hasCharStoryTable };
}

/**
 * The legacy content schema of the connected database, probed once per pool.
 *
 * The probe costs four `information_schema` round-trips, once per process.
 * A failed probe is never cached — the next call retries it, so a database
 * that is briefly unreachable does not poison the process.
 */
export function getLegacyContentSchema(pool: Pool): Promise<LegacyContentSchema> {
  const cached = schemaCache.get(pool);
  if (cached) return cached;

  const pending = probe(pool).catch((error: unknown) => {
    schemaCache.delete(pool);
    throw error;
  });
  schemaCache.set(pool, pending);
  return pending;
}

/**
 * Render a column list as a SELECT list, quoting each identifier.
 *
 * The names come from `information_schema`, not from user input, but MySQL
 * does not allow a bind parameter in an identifier position — so they are
 * interpolated, quoted, and backticked.
 */
export function toSelectList(columns: readonly string[]): string {
  return columns.map((column) => `\`${column}\``).join(', ');
}
