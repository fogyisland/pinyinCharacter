/**
 * One-time normalization: rename legacy `poems.form` values to canonical names.
 * Legacy:  五言律诗, 七言律诗, 五言古诗, 七言古诗
 * Canon:   五律,   七律,   五言古风, 七言古风
 *
 * Idempotent: WHERE clause matches old names only. After the first run all rows
 * are renamed, so a second run updates 0 rows.
 *
 * Run: DATABASE_URL=mysql://... pnpm tsx scripts/normalize-existing-form.ts
 * After verifying on dev+prod, delete this script.
 */
import { getPool, closePool } from '../lib/db';

export const NORMALIZE_MAP: Record<string, string> = {
  '五言律诗': '五律',
  '七言律诗': '七律',
  '五言古诗': '五言古风',
  '七言古诗': '七言古风',
};

export async function normalizeExistingForm(): Promise<{ updated: number }> {
  const pool = getPool();
  let updated = 0;
  for (const [from, to] of Object.entries(NORMALIZE_MAP)) {
    const [result] = await pool.query<any>(
      `UPDATE poems SET form = ? WHERE form = ?`,
      [to, from]
    );
    const n = (result as any)?.affectedRows ?? 0;
    updated += n;
    console.log(`[normalize] ${from} -> ${to}: ${n} rows updated`);
  }
  return { updated };
}

if (require.main === module) {
  normalizeExistingForm()
    .then((r) => {
      console.log(`[normalize] total updated: ${r.updated}`);
      return closePool();
    })
    .catch((err) => {
      console.error('[normalize] failed:', err);
      process.exit(1);
    });
}
