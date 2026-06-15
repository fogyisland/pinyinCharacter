/**
 * 将 rare_chars 表的 pinyin 复制到 chars 表 (level 3 那 1412 字)。
 * 仅在 chars.pinyin 为空时填充,不覆盖已有值。
 *
 * 一次性脚本,执行后即可删除。
 *
 * Run: pnpm tsx scripts/migrate-pinyin-from-rare-chars.ts
 */
import { getPool, closePool } from '../lib/db';

export async function migratePinyinFromRareChars(): Promise<{ updated: number; skipped: number }> {
  const pool = getPool();
  const [result] = await pool.query<any>(
    `UPDATE chars c
     JOIN rare_chars r ON c.\`char\` COLLATE utf8mb4_unicode_ci = r.\`char\`
     SET c.pinyin = r.pinyin
     WHERE (c.pinyin IS NULL OR c.pinyin = '')
       AND r.pinyin IS NOT NULL AND r.pinyin != ''`,
  );
  const updated = (result as any).affectedRows ?? 0;

  const [totalRows] = await pool.query<any[]>(
    `SELECT COUNT(*) AS n FROM chars WHERE pinyin IS NOT NULL AND pinyin != ''`,
  );
  const total = Number(totalRows[0].n);

  console.error(`[migrate-pinyin] updated ${updated} rows; chars.pinyin now ${total} rows`);
  return { updated, skipped: total - updated };
}

async function main() {
  await migratePinyinFromRareChars();
  await closePool();
}

if (require.main === module) {
  main().catch(err => { console.error(err); process.exit(1); });
}