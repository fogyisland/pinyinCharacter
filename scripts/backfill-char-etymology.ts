/**
 * CLI shim for initCharEtymology (lives in scripts/init-db.ts so the wizard
 * route at /api/init/init-char-etymology can call it without a separate
 * export path). The actual logic was moved here on 2026-07-10 — this script
 * remains for ad-hoc prod debugging.
 *
 * Usage: DATABASE_URL=<db> npx tsx scripts/backfill-char-etymology.ts
 */
import { closePool } from '../lib/db';
import { initCharEtymology as backfillCharEtymology } from './init-db';

export { backfillCharEtymology };

if (require.main === module) {
  backfillCharEtymology()
    .then((stats) => {
      console.log(`[backfill-char-etymology] inserted=${stats.inserted} skipped=${stats.skipped} failed=${stats.failed ?? 'none'}`);
      return closePool();
    })
    .catch((err) => {
      console.error('[backfill-char-etymology] failed:', err);
      process.exit(1);
    });
}
