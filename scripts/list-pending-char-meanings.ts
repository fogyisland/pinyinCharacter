// Usage: node --env-file=.env scripts/list-pending-char-meanings.ts [offset] [limit]
// Prints the next batch of chars (level 1+2) with empty meaning_zh as JSON
import mysql from 'mysql2/promise';

async function main() {
  const offset = Number(process.argv[2] ?? 0);
  const limit = Math.min(Number(process.argv[3] ?? 30), 100);
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  const [rows] = await conn.query<any[]>(
    `SELECT \`char\`, pinyin, level FROM chars
     WHERE (meaning_zh IS NULL OR meaning_zh = '')
     AND level IN (1, 2)
     ORDER BY level ASC, \`char\` ASC
     LIMIT ? OFFSET ?`,
    [limit, offset]
  );
  await conn.end();
  process.stdout.write(JSON.stringify(rows));
}

main().catch((e) => { console.error(e); process.exit(1); });
