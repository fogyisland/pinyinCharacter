/**
 * One-shot script: print rare_chars stats.
 * Usage: pnpm tsx --env-file=.env scripts/show-stats.ts
 */
import { getPool, closePool } from '../lib/db';

async function main() {
  const pool = getPool();
  const [[totals]] = await pool.query<any[]>(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN pinyin <> '' THEN 1 ELSE 0 END) AS pinyin_filled,
       SUM(CASE WHEN meaning <> '' THEN 1 ELSE 0 END) AS meaning_filled,
       SUM(CASE WHEN story <> '' THEN 1 ELSE 0 END) AS story_filled,
       SUM(CASE WHEN needs_review = 1 THEN 1 ELSE 0 END) AS needs_review
     FROM rare_chars`
  );
  const [bySource] = await pool.query<any[]>(
    `SELECT generated_by, COUNT(*) AS n
     FROM rare_chars
     WHERE generated_by IS NOT NULL
     GROUP BY generated_by
     ORDER BY n DESC`
  );

  console.log(`总数:           ${totals.total}`);
  console.log(`拼音已填:       ${totals.pinyin_filled}`);
  console.log(`释义已填:       ${totals.meaning_filled}`);
  console.log(`故事已填:       ${totals.story_filled}`);
  console.log(`待复核:         ${totals.needs_review}`);
  console.log(`来源分布:`);
  for (const r of bySource) {
    console.log(`  ${r.generated_by} = ${r.n}`);
  }

  await closePool();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
