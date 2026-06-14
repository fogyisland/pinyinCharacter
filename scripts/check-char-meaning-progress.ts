// Usage: node --env-file=.env scripts/check-char-meaning-progress.ts
// Returns counts of chars (level 1+2) with vs without meaning_zh
import mysql from 'mysql2/promise';

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  const [rows] = await conn.query<any[]>(
    `SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN meaning_zh IS NOT NULL AND meaning_zh != '' THEN 1 ELSE 0 END) AS done,
      SUM(CASE WHEN meaning_zh IS NULL OR meaning_zh = '' THEN 1 ELSE 0 END) AS pending
     FROM chars WHERE level IN (1, 2)`
  );
  await conn.end();
  process.stdout.write(JSON.stringify(rows[0]));
}

main().catch((e) => { console.error(e); process.exit(1); });
