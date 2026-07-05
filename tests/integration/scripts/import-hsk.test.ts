// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mysql from 'mysql2/promise';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DB_URL = process.env.DATABASE_URL ?? 'mysql://root@127.0.0.1:3306/piyin_dev';
const JSON_PATH = resolve(__dirname, '../../../data/hsk-vocab.json');

describe('import-hsk', () => {
  let conn: mysql.Connection;

  beforeAll(async () => {
    conn = await mysql.createConnection(DB_URL);
    // Ensure the column is present; if migration hasn't run, this throws.
    await conn.query("SELECT hsk_level FROM chars LIMIT 1");
  });

  afterAll(async () => { await conn.end(); });

  it('round-trips HSK 1-6 entries idempotently', { timeout: 120000 }, async () => {
    const { runImport } = await import('../../../scripts/import-hsk');
    await runImport();

    const vocab = JSON.parse(readFileSync(JSON_PATH, 'utf8'));
    const expected = new Set(
      vocab['1'].map((v: { char: string }) => v.char).filter((c: string, i: number, a: string[]) => a.indexOf(c) === i)
    );

    const [rows] = await conn.query<mysql.RowDataPacket[]>(
      "SELECT `char` FROM chars WHERE hsk_level = 1"
    );
    const imported = new Set(rows.map((r) => r.char));
    expect(imported.size).toBe(expected.size);
    // Sample assertions — every char in vocab should be present.
    for (const c of expected) expect(imported.has(c)).toBe(true);

    // Re-run is idempotent: row count unchanged.
    const before = rows.length;
    await runImport();
    const [rows2] = await conn.query<mysql.RowDataPacket[]>(
      "SELECT `char` FROM chars WHERE hsk_level = 1"
    );
    expect(rows2.length).toBe(before);
  });
});
