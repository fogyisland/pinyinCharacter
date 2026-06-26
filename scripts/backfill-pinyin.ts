/**
 * Backfill pinyin for poems where pinyin arrays are empty (lines exist but
 * word arrays are all []). Triggered by build-poems-extra.ts skipping pinyin-pro.
 *
 * Strategy: read each poem's content lines, run pinyin-pro on each char,
 * write back as `pinyin: string[][]` matching content line count.
 *
 * Idempotent: WHERE clause `JSON_EXTRACT(pinyin, '$[0][0]') IS NULL OR ''` only
 * matches poems with missing first-line pinyin. After first run, 0 rows match.
 *
 * Run: pnpm tsx --env-file=.env scripts/backfill-pinyin.ts
 */
import { pinyin } from 'pinyin-pro';
import { getPool, closePool } from '../lib/db';

function linePinyin(line: string): string[] {
  return Array.from(line).map((ch) => {
    if (!ch.trim()) return '';
    try {
      const result = pinyin(ch, { toneType: 'symbol', type: 'array' });
      if (Array.isArray(result) && result.length > 0 && typeof result[0] === 'string') {
        return result[0]!;
      }
    } catch {
      // fall through
    }
    return '';
  });
}

function parseContent(s: unknown): string[] {
  if (Array.isArray(s)) return s as string[];
  if (typeof s === 'string') {
    try {
      const v = JSON.parse(s);
      return Array.isArray(v) ? (v as string[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

export async function backfillPinyin(): Promise<{ updated: number; skipped: number }> {
  const pool = getPool();
  const [rows] = await pool.query<any[]>(
    `SELECT id, content FROM poems
     WHERE JSON_LENGTH(content) > 0
       AND (pinyin IS NULL
            OR JSON_LENGTH(pinyin) = 0
            OR JSON_EXTRACT(pinyin, '$[0][0]') IS NULL
            OR JSON_EXTRACT(pinyin, '$[0][0]') = '')`,
  );
  let updated = 0;
  let skipped = 0;
  for (const r of rows as any[]) {
    const lines = parseContent(r.content);
    if (lines.length === 0) {
      skipped++;
      continue;
    }
    const pinyinArr = lines.map(linePinyin);
    await pool.execute(
      `UPDATE poems SET pinyin = ? WHERE id = ?`,
      [JSON.stringify(pinyinArr), r.id],
    );
    updated++;
    if (updated % 50 === 0) console.log(`[backfill-pinyin] updated ${updated}...`);
  }
  console.log(`[backfill-pinyin] updated=${updated} skipped=${skipped}`);
  return { updated, skipped };
}

if (require.main === module) {
  backfillPinyin()
    .then(() => closePool())
    .catch((err) => {
      console.error('[backfill-pinyin] failed:', err);
      process.exit(1);
    });
}
