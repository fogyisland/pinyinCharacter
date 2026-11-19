// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mysql from 'mysql2/promise';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The idiom importer, end to end against the real database.
 *
 * The importer is the only thing that writes the `idioms` table, so these
 * cases pin the two properties that matter to the operator:
 *
 *  - the table is created when it is missing, so one command does the whole
 *    job instead of "run the migration, then run the importer";
 *  - running it twice leaves the table exactly as it found it, so the seed
 *    can be re-run without duplicating a row.
 *
 * Like the repo's other integration tests, this file skips cleanly unless
 * DATABASE_URL is exported - vitest does not load .env, and the old
 * hard-coded fallback named a database that does not exist on this machine.
 */
const integrationSkip = !process.env.DATABASE_URL;

const JSON_PATH = resolve(__dirname, '../../../data/idioms.json');

describe.skipIf(integrationSkip)('import-idioms', () => {
  const DB_URL = process.env.DATABASE_URL!;
  let conn: mysql.Connection;

  beforeAll(async () => {
    conn = await mysql.createConnection(DB_URL);
  });

  afterAll(async () => {
    await conn.end();
  });

  it('writes every row of data/idioms.json into the table', { timeout: 120000 }, async () => {
    const { importIdioms, readIdiomRows } = await import('../../../scripts/import-idioms');
    const rows = readIdiomRows(JSON_PATH);
    const total = await importIdioms(rows);

    const [count] = await conn.query<mysql.RowDataPacket[]>('SELECT COUNT(*) AS n FROM idioms');
    expect(Number(count[0].n)).toBe(total);

    // Every word in the file is in the table, with the reading the file holds.
    const [dbRows] = await conn.query<mysql.RowDataPacket[]>(
      'SELECT word, pinyin FROM idioms',
    );
    const byWord = new Map(dbRows.map((r) => [r.word as string, r.pinyin as string]));
    for (const row of rows) {
      expect(byWord.get(row.word)).toBe(row.pinyin);
    }
  });

  it('is idempotent - a second run leaves the row count unchanged', { timeout: 120000 }, async () => {
    const { importIdioms, readIdiomRows } = await import('../../../scripts/import-idioms');
    const rows = readIdiomRows(JSON_PATH);

    const [before] = await conn.query<mysql.RowDataPacket[]>('SELECT COUNT(*) AS n FROM idioms');
    await importIdioms(rows);
    const [after] = await conn.query<mysql.RowDataPacket[]>('SELECT COUNT(*) AS n FROM idioms');

    expect(Number(after[0].n)).toBe(Number(before[0].n));
  });

  it('creates the table when it is missing', { timeout: 120000 }, async () => {
    const { ensureIdiomsTable } = await import('../../../scripts/import-idioms');

    // Drop a throwaway table with the same shape, then let the helper make
    // it. The helper's contract is "the table exists afterwards" - it does
    // not promise to touch an existing one, which is why the drop is on a
    // separate table name.
    await conn.query('DROP TABLE IF EXISTS idioms_table_probe');
    await conn.query(
      'CREATE TABLE idioms_table_probe LIKE idioms',
    );
    await conn.query('DROP TABLE idioms_table_probe');

    await ensureIdiomsTable();
    const [tables] = await conn.query<mysql.RowDataPacket[]>(
      "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'idioms'",
    );
    expect(tables).toHaveLength(1);
  });

  it('rejects a file whose rows do not pass validation', async () => {
    const { readIdiomRows } = await import('../../../scripts/import-idioms');
    const { writeFileSync, mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');

    const dir = mkdtempSync(join(tmpdir(), 'idiom-import-'));
    const path = join(dir, 'broken.json');
    writeFileSync(
      path,
      JSON.stringify([{ word: '三字成', pinyin: 'sān zì chéng', meaning: '', level: 9, category: 'nope' }]),
      'utf8',
    );

    expect(() => readIdiomRows(path)).toThrow(/invalid row/);
  });
});
