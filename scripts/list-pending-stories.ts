// Usage: node --env-file=.env scripts/list-pending-stories.ts [offset] [limit]
// Prints the next batch of rare_chars with empty meaning as JSON
import mysql from 'mysql2/promise';
import type { RowDataPacket } from 'mysql2';

/** One rare char that is still missing its story. */
interface PendingStoryRow extends RowDataPacket {
  char: string;
  pinyin: string;
}

async function main() {
  const offset = Number(process.argv[2] ?? 0);
  const limit = Math.min(Number(process.argv[3] ?? 30), 100);
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  const [rows] = await conn.query<PendingStoryRow[]>(
    `SELECT \`char\`, pinyin FROM rare_chars
     WHERE meaning IS NULL OR meaning = ''
     ORDER BY \`char\` ASC
     LIMIT ? OFFSET ?`,
    [limit, offset],
  );
  await conn.end();
  process.stdout.write(JSON.stringify(rows));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
