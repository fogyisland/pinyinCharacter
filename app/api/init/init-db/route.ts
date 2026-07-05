import { NextResponse } from 'next/server';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { isSetupRouteEnabled } from '@/lib/setup';

/**
 * Phase 3b of /init wizard. Order matters:
 *   1. initDb()  — creates the 25-table base schema + seeds app_config + auto-populates poems/sutras/chars.
 *   2. runMigrations() — applies scripts/migrations/*.sql (ALTER existing tables, CREATE new ones
 *      like notes / audio_tracks / email_campaigns).
 *
 * initDb MUST run first because 5 migrations (cell-style-cross, brush-paper-size,
 * tool-presentation-split, cell-style-trace, hsk-level) ALTER tables like `worksheets`
 * and `chars` that don't exist on a fresh DB. The reverse order crashes on ALTER of
 * non-existent tables.
 *
 * Both steps are idempotent (CREATE TABLE IF NOT EXISTS / ALTER MODIFY with same
 * type is a no-op), so re-runs are safe. Returns rich stats so the /init wizard
 * can render real progress per sub-step.
 */
export async function POST() {
  return withErrorHandling(async () => {
    if (!(await isSetupRouteEnabled())) {
      return badRequest('setup_disabled', '/init is disabled.');
    }
    if (!process.env.DATABASE_URL) {
      return badRequest('db_not_configured', 'Configure DATABASE_URL first (Step 1).');
    }
    const { initDb } = await import('@/scripts/init-db');
    const stats = await initDb();
    const { runMigrations } = await import('@/scripts/migrate');
    const migrations = await runMigrations();
    return NextResponse.json({
      ok: true,
      data: {
        migrations: { files: migrations.files, statements: migrations.statements },
        stats,
      },
    });
  });
}
