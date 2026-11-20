import type { Pool } from 'mysql2/promise';
import type { RowDataPacket } from 'mysql2';
import { getPool } from './db';
import { collectSchemaExpectations, type SchemaExpectation } from './schema-expectations';

/**
 * Compare the connected database against the schema the repository
 * declares.
 *
 * The expectation comes from `lib/schema-expectations.ts` — the base DDL
 * in `scripts/init-db.ts` plus the incremental `scripts/migrations/*.sql`.
 * This module reads what the database actually has and reports the
 * difference **by name**.
 *
 * ## Why "by name" and not "by count"
 *
 * The check this replaces compared a table count against a hand-written
 * number. A count cannot say *which* table is missing, and a missing
 * column does not move the count at all — so `chars` without `hsk_level`
 * stayed green while `/game` answered 404 on every tier and 503 on every
 * round. The report here names the missing table and the missing column
 * and says which file should have created them, so the operator knows
 * what to run.
 *
 * ## The cache
 *
 * The probe is cached per pool, like `lib/legacy-content-schema.ts` does:
 * the schema does not change under a live process. But the whole point of
 * this screen is to run a migration and then look again, so the cache is
 * **invalidatable** — `clearSchemaCache()` is called after a migration
 * run. A failed probe is never cached, so a database that is briefly
 * unreachable does not poison the process.
 */

/** A table the database does not have. */
export interface MissingTable {
  /** The table name. */
  table: string;
  /** The file that declares it. */
  source: string;
}

/** A column the database does not have. */
export interface MissingColumn {
  /** The table the column belongs to. */
  table: string;
  /** The column name. */
  column: string;
  /** The file that declares it. */
  source: string;
}

/** What the comparison found. */
export interface SchemaComparison {
  /** The tables the database is missing. */
  missingTables: MissingTable[];
  /** The columns the database is missing, on tables that exist. */
  missingColumns: MissingColumn[];
  /** How many tables the database holds. */
  actualTables: number;
  /** How many tables the repository declares. */
  expectedTables: number;
  /** How many columns the database holds, across the declared tables. */
  actualColumns: number;
  /** How many columns the repository declares. */
  expectedColumns: number;
  /** Whether the database has everything the repository declares. */
  upToDate: boolean;
}

interface TableRow extends RowDataPacket {
  table_name: string;
}

interface ColumnRow extends RowDataPacket {
  table_name: string;
  column_name: string;
}

/** The probe result, cached per pool. */
const schemaCache = new WeakMap<Pool, Promise<SchemaComparison>>();

/**
 * Drop the cached probe.
 *
 * The admin screen calls this after it runs a migration: without it the
 * screen would report the state from *before* the migration, which is
 * precisely the moment the operator looks at it.
 */
export function clearSchemaCache(): void {
  schemaCache.delete(getPool());
}

/** Read the table names the database holds. */
async function listTables(pool: Pool): Promise<string[]> {
  const [rows] = await pool.query<TableRow[]>(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE()`,
  );
  return rows.map((row) => row.table_name);
}

/** Read the columns the database holds, as `table.column` pairs. */
async function listColumns(pool: Pool): Promise<Set<string>> {
  const [rows] = await pool.query<ColumnRow[]>(
    `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = DATABASE()`,
  );
  return new Set(rows.map((row) => `${row.table_name}.${row.column_name}`));
}

/**
 * The comparison, computed from the expectation and the database.
 *
 * A column whose table is missing entirely is not reported separately:
 * the missing table is the one fact the operator needs, and listing its
 * columns too would be noise.
 */
async function computeComparison(
  pool: Pool,
  expectations: SchemaExpectation[],
): Promise<SchemaComparison> {
  const [tables, columns] = await Promise.all([listTables(pool), listColumns(pool)]);
  const presentTables = new Set(tables);

  const missingTables: MissingTable[] = [];
  const missingColumns: MissingColumn[] = [];
  const seenTables = new Set<string>();
  let expectedColumns = 0;

  for (const expectation of expectations) {
    if (expectation.column === null) {
      if (seenTables.has(expectation.table)) continue;
      seenTables.add(expectation.table);
      if (!presentTables.has(expectation.table)) {
        missingTables.push({ table: expectation.table, source: expectation.source });
      }
      continue;
    }
    expectedColumns += 1;
    // A column of a table that is missing is not a separate finding.
    if (!presentTables.has(expectation.table)) continue;
    if (!columns.has(`${expectation.table}.${expectation.column}`)) {
      missingColumns.push({
        table: expectation.table,
        column: expectation.column,
        source: expectation.source,
      });
    }
  }

  // The columns counted as actual are the ones on the declared tables —
  // the columns of an unrelated table are not part of this comparison.
  let actualColumns = 0;
  for (const key of columns) {
    if (seenTables.has(key.slice(0, key.indexOf('.')))) actualColumns += 1;
  }

  return {
    missingTables,
    missingColumns,
    actualTables: tables.length,
    expectedTables: seenTables.size,
    actualColumns,
    expectedColumns,
    upToDate: missingTables.length === 0 && missingColumns.length === 0,
  };
}

/**
 * Compare the database against the expectation, probing once per pool.
 *
 * The probe is cached; call `clearSchemaCache()` to force a fresh look.
 */
export function compareSchema(): Promise<SchemaComparison> {
  const pool = getPool();
  const cached = schemaCache.get(pool);
  if (cached) return cached;

  const pending = Promise.resolve()
    .then(() => collectSchemaExpectations())
    .then((expectations) => computeComparison(pool, expectations))
    .catch((error: unknown) => {
      // A failed probe is never cached — the next call retries it.
      schemaCache.delete(pool);
      throw error;
    });
  schemaCache.set(pool, pending);
  return pending;
}
