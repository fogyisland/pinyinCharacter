/**
 * `lib/schema-check.ts` — compare the database against the expectation.
 *
 * The admin seed screen answers "is the database behind the code?". The
 * expectation comes from `lib/schema-expectations.ts`; this module reads
 * what the database actually has and reports the difference.
 *
 * Two things make this harder than a table count:
 *
 *  1. **The comparison must name what is missing.** "3 tables and 2
 *     columns are missing" is not actionable; "`idioms`, `chars.hsk_level`"
 *     is. The report therefore lists the missing items by name, with the
 *     file that should have created them.
 *
 *  2. **A cache that cannot be refreshed is a trap.** The schema probe
 *     result is cached per pool, because the schema does not change under
 *     a live process — that is what `lib/legacy-content-schema.ts` does.
 *     But the whole point of this screen is to run a migration and then
 *     look again, so a cached answer would report the state *before* the
 *     migration. The cache is therefore explicit and invalidatable.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Pool } from 'mysql2/promise';
import type { RowDataPacket } from 'mysql2';

const queryMock = vi.fn();

const pool = {
  query: queryMock,
} as unknown as Pool;

vi.mock('@/lib/db', () => ({
  getPool: () => pool,
}));

vi.mock('@/lib/schema-expectations', () => ({
  collectSchemaExpectations: vi.fn(),
}));

import {
  compareSchema,
  clearSchemaCache,
  type SchemaComparison,
} from '@/lib/schema-check';
import { collectSchemaExpectations } from '@/lib/schema-expectations';

const mockedCollect = vi.mocked(collectSchemaExpectations);

interface TableRow extends RowDataPacket {
  table_name: string;
}
interface ColumnRow extends RowDataPacket {
  table_name: string;
  column_name: string;
}

/** Answer the two information_schema queries with a fixed shape. */
function mockSchema(tables: string[], columns: Array<[string, string]>): void {
  queryMock.mockImplementation(async (sql: string) => {
    if (sql.includes('information_schema.tables')) {
      const rows: TableRow[] = tables.map((table_name) => ({ table_name }));
      return [rows, []];
    }
    const rows: ColumnRow[] = columns.map(([table_name, column_name]) => ({
      table_name,
      column_name,
    }));
    return [rows, []];
  });
}

beforeEach(() => {
  queryMock.mockReset();
  clearSchemaCache();
  mockedCollect.mockReset();
});

describe('compareSchema', () => {
  it('reports nothing missing when the database matches the expectation', async () => {
    mockedCollect.mockReturnValue([
      { table: 'chars', column: null, source: 'scripts/init-db.ts', sources: ['scripts/init-db.ts'] },
      { table: 'chars', column: 'hsk_level', source: 'scripts/migrations/a.sql', sources: ['scripts/migrations/a.sql'] },
    ]);
    mockSchema(['chars'], [['chars', 'hsk_level']]);

    const comparison = await compareSchema();
    expect(comparison.missingTables).toEqual([]);
    expect(comparison.missingColumns).toEqual([]);
    expect(comparison.upToDate).toBe(true);
  });

  it('names the table that is missing', async () => {
    mockedCollect.mockReturnValue([
      { table: 'idioms', column: null, source: 'scripts/migrations/a.sql', sources: ['scripts/migrations/a.sql'] },
    ]);
    mockSchema([], []);

    const comparison = await compareSchema();
    expect(comparison.missingTables).toEqual([
      { table: 'idioms', source: 'scripts/migrations/a.sql' },
    ]);
    expect(comparison.upToDate).toBe(false);
  });

  it('names the column that is missing, with the file that should have added it', async () => {
    mockedCollect.mockReturnValue([
      { table: 'chars', column: null, source: 'scripts/init-db.ts', sources: ['scripts/init-db.ts'] },
      { table: 'chars', column: 'hsk_level', source: 'scripts/migrations/hsk.sql', sources: ['scripts/migrations/hsk.sql'] },
    ]);
    // The table is there, the column is not — the case a table count
    // can never see.
    mockSchema(['chars'], []);

    const comparison = await compareSchema();
    expect(comparison.missingTables).toEqual([]);
    expect(comparison.missingColumns).toEqual([
      { table: 'chars', column: 'hsk_level', source: 'scripts/migrations/hsk.sql' },
    ]);
    expect(comparison.upToDate).toBe(false);
  });

  it('does not report a column of a table that is missing altogether', async () => {
    // The table is gone, so every one of its columns is gone with it.
    // Listing them separately would be noise; the missing table is the
    // one fact the operator needs.
    mockedCollect.mockReturnValue([
      { table: 'idioms', column: null, source: 'scripts/migrations/a.sql', sources: ['scripts/migrations/a.sql'] },
      { table: 'idioms', column: 'word', source: 'scripts/migrations/a.sql', sources: ['scripts/migrations/a.sql'] },
    ]);
    mockSchema([], []);

    const comparison = await compareSchema();
    expect(comparison.missingTables).toEqual([
      { table: 'idioms', source: 'scripts/migrations/a.sql' },
    ]);
    expect(comparison.missingColumns).toEqual([]);
  });

  it('counts the tables and the columns the database holds', async () => {
    mockedCollect.mockReturnValue([
      { table: 'chars', column: null, source: 'scripts/init-db.ts', sources: ['scripts/init-db.ts'] },
    ]);
    mockSchema(['chars', 'users'], [['chars', 'level']]);

    const comparison = await compareSchema();
    expect(comparison.actualTables).toBe(2);
    expect(comparison.expectedTables).toBe(1);
    expect(comparison.actualColumns).toBe(1);
    expect(comparison.expectedColumns).toBe(0);
  });

  it('caches the probe per pool', async () => {
    mockedCollect.mockReturnValue([
      { table: 'chars', column: null, source: 'scripts/init-db.ts', sources: ['scripts/init-db.ts'] },
    ]);
    mockSchema(['chars'], []);

    await compareSchema();
    const afterFirst = queryMock.mock.calls.length;
    await compareSchema();
    expect(queryMock.mock.calls.length).toBe(afterFirst);
  });

  it('probes again after the cache is cleared', async () => {
    // The screen runs a migration and then looks again. A cache that
    // cannot be cleared would report the state from before the
    // migration, which is exactly when the operator looks.
    mockedCollect.mockReturnValue([
      { table: 'idioms', column: null, source: 'scripts/migrations/a.sql', sources: ['scripts/migrations/a.sql'] },
    ]);
    mockSchema([], []);

    const before = await compareSchema();
    expect(before.missingTables.length).toBe(1);

    mockSchema(['idioms'], []);
    clearSchemaCache();

    const after = await compareSchema();
    expect(after.missingTables).toEqual([]);
  });

  it('does not cache a failed probe', async () => {
    // A database that is briefly unreachable must not poison the
    // process: the next call has to try again.
    mockedCollect.mockReturnValue([
      { table: 'chars', column: null, source: 'scripts/init-db.ts', sources: ['scripts/init-db.ts'] },
    ]);
    queryMock.mockRejectedValueOnce(new Error('connection lost'));

    await expect(compareSchema()).rejects.toThrow('connection lost');

    mockSchema(['chars'], []);
    const comparison = await compareSchema();
    expect(comparison.upToDate).toBe(true);
  });
});
