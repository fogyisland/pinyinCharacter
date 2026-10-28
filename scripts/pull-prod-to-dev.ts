/**
 * One-off: pull all chars + rare_chars from prod piyin to local piyin_dev.
 *
 * Idempotent: INSERT IGNORE on PK (chars.char, rare_chars.char). Re-runnable.
 *
 *   pnpm tsx scripts/pull-prod-to-dev.ts
 *
 * Reads prod URL from .env (DATABASE_URL_REMOTE or hard-coded fallback);
 * writes to whatever DATABASE_URL points to (piyin_dev in .env.local).
 */
import mysql from 'mysql2/promise';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';

const PROD_URL =
  process.env.DATABASE_URL_REMOTE ?? 'mysql://piyin:Admin909217@139.5.108.245:3306/piyin';
const LOCAL_URL = process.env.DATABASE_URL;
if (!LOCAL_URL) throw new Error('DATABASE_URL (local) is required');

const CHUNK = 500;

/** Values this script binds to a SQL placeholder. */
type SqlParam = string | number | bigint | boolean | Date | Buffer | null;

/**
 * A row whose columns are only known at runtime (the pulled tables). The
 * `constructor` member is spelled out so the shape still satisfies
 * `RowDataPacket`, which mysql2 requires of the row generic.
 */
type DynamicRow = { constructor: { name: 'RowDataPacket' } } & Record<string, SqlParam>;

/** A single count, as `SELECT COUNT(*) AS n` returns it. */
interface CountRow extends RowDataPacket {
  n: number | string;
}

/** The MIN/MAX codepoint bounds of a table. */
interface MinMaxRow extends RowDataPacket {
  mn: string;
  mx: string;
}

/** One row of `SHOW COLUMNS FROM <table>`. */
interface ShowColumnsRow extends RowDataPacket {
  Field: string;
}

/** One level bucket of the local chars table. */
interface LevelCountRow extends RowDataPacket {
  level: number;
  n: number | string;
}

async function pull(
  prod: mysql.Connection,
  local: mysql.Connection,
  table: string,
  cols: string[],
) {
  const colList = cols.map((c) => '`' + c + '`').join(',');
  const placeholders = '(' + cols.map(() => '?').join(',') + ')';

  const [cnt] = await prod.query<CountRow[]>(`SELECT COUNT(*) AS n FROM ${table}`);
  console.log(`${table}: ${cnt[0].n} rows in prod`);

  const [minMax] = await prod.query<MinMaxRow[]>(
    `SELECT MIN(\`char\`) AS mn, MAX(\`char\`) AS mx FROM ${table}`,
  );
  console.log(
    `  codepoint range: ${minMax[0].mn} (U+${minMax[0].mn.codePointAt(0)!.toString(16).toUpperCase()}) - ${minMax[0].mx} (U+${minMax[0].mx.codePointAt(0)!.toString(16).toUpperCase()})`,
  );

  let offset = 0;
  let pulled = 0;
  let inserted = 0;
  // Stream in chunks keyed by ordinal position to avoid collation-related sort issues on `char`.
  while (true) {
    const [rows] = await prod.query<DynamicRow[]>(
      `SELECT ${colList} FROM ${table} ORDER BY \`char\` LIMIT ? OFFSET ?`,
      [CHUNK, offset],
    );
    if (rows.length === 0) break;
    pulled += rows.length;

    const values: SqlParam[] = [];
    for (const r of rows) {
      for (const c of cols) values.push(r[c]);
    }
    const flat = rows.map((r) => cols.map((c) => r[c]));
    const [res] = await local.query<ResultSetHeader>(
      `INSERT IGNORE INTO ${table} (${colList}) VALUES ${flat.map(() => placeholders).join(',')}`,
      flat.flat(),
    );
    inserted += res.affectedRows;
    offset += CHUNK;
    if (rows.length < CHUNK) break;
  }
  console.log(`  pulled=${pulled} inserted_new=${inserted} skipped_existing=${pulled - inserted}`);
  return { pulled, inserted };
}

async function main() {
  const prod = await mysql.createConnection({ uri: PROD_URL });
  const local = await mysql.createConnection({ uri: LOCAL_URL, charset: 'utf8mb4' });

  console.log('=== CHARS ===');
  const [cCols] = await prod.query<ShowColumnsRow[]>('SHOW COLUMNS FROM chars');
  const charCols = cCols.map((c) => c.Field);
  await pull(prod, local, 'chars', charCols);

  console.log('=== RARE_CHARS ===');
  const [rCols] = await prod.query<ShowColumnsRow[]>('SHOW COLUMNS FROM rare_chars');
  const rareCols = rCols.map((c) => c.Field);
  await pull(prod, local, 'rare_chars', rareCols);

  // Final local counts
  const [lc] = await local.query<LevelCountRow[]>(
    'SELECT level, COUNT(*) AS n FROM chars GROUP BY level',
  );
  console.log('local chars by level:', JSON.stringify(lc));
  const [lr] = await local.query<CountRow[]>('SELECT COUNT(*) AS n FROM rare_chars');
  console.log('local rare_chars:', lr[0].n);

  await prod.end();
  await local.end();
  console.log('DONE');
}

main().catch((e) => {
  console.error('ERR', e);
  process.exit(1);
});
