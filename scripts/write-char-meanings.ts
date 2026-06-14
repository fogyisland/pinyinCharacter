// Usage: node --env-file=.env scripts/write-char-meanings.ts
// Reads stdin: a JSON array of { char, meaning_zh }
// Updates chars.meaning_zh and sets generated_by='claude', generated_at=NOW()
import mysql from 'mysql2/promise';
import { readFileSync } from 'node:fs';

async function main() {
  const stdin = readFileSync(0, 'utf8');
  const updates: Array<{ char: string; meaning_zh: string }> = JSON.parse(stdin);
  if (!Array.isArray(updates) || updates.length === 0) {
    console.error('No updates provided (empty array)');
    process.exit(1);
  }

  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  let ok = 0;
  for (const u of updates) {
    if (!u.char || !u.meaning_zh) {
      console.error('Skipping malformed entry:', u);
      continue;
    }
    await conn.query(
      `UPDATE chars
       SET meaning_zh = ?, updated_at = NOW()
       WHERE \`char\` = ?`,
      [u.meaning_zh, u.char]
    );
    ok++;
  }
  await conn.end();
  console.log(`[write-char-meanings] updated ${ok} rows`);
}

main().catch((e) => { console.error(e); process.exit(1); });
