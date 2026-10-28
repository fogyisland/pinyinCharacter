// Usage: node --env-file=.env scripts/check-char-meaning-progress.ts
// Returns counts of chars (level 1+2) with vs without meaning_zh
import mysql from 'mysql2/promise';
import type { RowDataPacket } from 'mysql2';

/**
 * The single summary row.
 *
 * `SUM()` over an INT column returns DECIMAL in MySQL, and mysql2 hands
 * DECIMAL back as a string unless `decimalNumbers` is on — hence the union.
 */
interface MeaningProgressRow extends RowDataPacket {
  total: number | string;
  done: number | string;
  pending: number | string;
}

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  const [rows] = await conn.query<MeaningProgressRow[]>(
    `SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN meaning_zh IS NOT NULL AND meaning_zh != '' THEN 1 ELSE 0 END) AS done,
      SUM(CASE WHEN meaning_zh IS NULL OR meaning_zh = '' THEN 1 ELSE 0 END) AS pending
     FROM chars WHERE level IN (1, 2)`,
  );
  await conn.end();
  process.stdout.write(JSON.stringify(rows[0]));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
