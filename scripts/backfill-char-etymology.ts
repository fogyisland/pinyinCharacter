/**
 * One-shot: backfill char_etymology rows for chars that exist in `chars` but
 * have no etymology row. After this script, char_etymology.row count == chars
 * row count (7929).
 *
 * Background: 2026-06-17 slim-DB refactor moved etymology story data to
 * data/content/<char>.json. import-content.ts only writes a char_etymology
 * row when the content JSON has a non-empty `etymology_story` field. The 10
 * chars in question have NO content JSON, so they never got a row.
 *
 * These chars also have no era glyphs in the 4 era fonts (jiaguwen/jinwen/
 * xiaozhuan/lishu) — verified via data/era-coverage.json. So the backfilled
 * row has era_*_has = 0, era_kaishu_has = 1 (DDL default), and era_*_font
 * set to the hardcoded ERA_FONT defaults from lib/etymology.ts. /etymology/<char>
 * will render kaishu-only, matching the "no glyph" reality.
 *
 * Idempotent: uses INSERT IGNORE so re-running is a no-op.
 *
 * Usage: DATABASE_URL=<db> pnpm tsx scripts/backfill-char-etymology.ts
 */
import { getPool, closePool } from '../lib/db';

// Mirror lib/etymology.ts:19-25 ERA_FONT map. Kept local so this one-shot
// script doesn't need to import a client-side module just for font names.
const ERA_FONT = {
  jiaguwen: 'YinQiJiaGuWen',
  jinwen: 'HanDianJinWen',
  xiaozhuan: 'QuanZiKuShuoWen',
  lishu: 'QuanZiKuLiDing',
  kaishu: 'KaiTi',
};

function isBmp(c: string): boolean {
  const cp = c.codePointAt(0);
  return cp != null && cp <= 0xFFFF;
}

export async function backfillCharEtymology(): Promise<{ inserted: number; bmp: number; supp: number }> {
  const pool = getPool();
  const [rows] = await pool.query<any[]>(
    `SELECT c.char FROM chars c LEFT JOIN char_etymology e ON c.char = e.char WHERE e.char IS NULL`,
  );
  const missing: string[] = (rows as any[]).map((r) => r.char);
  console.log(`[backfill-char-etymology] found ${missing.length} chars without etymology row`);

  if (missing.length === 0) {
    console.log('[backfill-char-etymology] nothing to backfill, done');
    return { inserted: 0, bmp: 0, supp: 0 };
  }

  let bmp = 0;
  let supp = 0;
  let inserted = 0;
  for (const ch of missing) {
    if (isBmp(ch)) bmp++; else supp++;
    await pool.execute(
      `INSERT IGNORE INTO char_etymology (\`char\`, era_jiaguwen_font, era_jiaguwen_has, era_jinwen_font, era_jinwen_has, era_xiaozhuan_font, era_xiaozhuan_has, era_lishu_font, era_lishu_has, era_kaishu_font, era_kaishu_has) VALUES (?, ?, 0, ?, 0, ?, 0, ?, 0, ?, 1)`,
      [
        ch,
        ERA_FONT.jiaguwen,
        ERA_FONT.jinwen,
        ERA_FONT.xiaozhuan,
        ERA_FONT.lishu,
        ERA_FONT.kaishu,
      ],
    );
    inserted++;
  }
  console.log(`[backfill-char-etymology] inserted ${inserted} rows (BMP=${bmp}, supp=${supp})`);
  return { inserted, bmp, supp };
}

if (require.main === module) {
  backfillCharEtymology()
    .then(() => closePool())
    .catch((err) => {
      console.error('[backfill-char-etymology] failed:', err);
      process.exit(1);
    });
}
