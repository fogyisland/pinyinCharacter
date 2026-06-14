// Usage: node --env-file=.env scripts/write-stories.ts
// Reads stdin: a JSON array of { char, meaning, story }
// Updates rare_chars: meaning, story, generated_by='claude', generated_at=NOW()
import mysql from 'mysql2/promise';
import { readFileSync } from 'node:fs';

async function main() {
  const stdin = readFileSync(0, 'utf8');
  const updates: Array<{ char: string; meaning: string; story: string }> = JSON.parse(stdin);
  if (!Array.isArray(updates) || updates.length === 0) {
    console.error('No updates provided (empty array)');
    process.exit(1);
  }

  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  let ok = 0;
  for (const u of updates) {
    if (!u.char || !u.meaning) {
      console.error('Skipping malformed entry:', u);
      continue;
    }
    await conn.query(
      `UPDATE rare_chars
       SET meaning = ?, story = ?, generated_by = 'claude', generated_at = NOW(), needs_review = 0
       WHERE \`char\` = ?`,
      [u.meaning, u.story || '', u.char]
    );
    ok++;
  }
  await conn.end();
  console.log(`[write-stories] updated ${ok} rows`);
}

main().catch((e) => { console.error(e); process.exit(1); });
