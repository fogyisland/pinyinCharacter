import { NextResponse } from 'next/server';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { isSetupRouteEnabled } from '@/lib/setup';

/**
 * Phase 3b of /init wizard. Runs migrations first (so additions like `notes`
 * exist before initDb's CREATE TABLE IF NOT EXISTS is even evaluated), then
 * initDb() — which creates the 25-table base schema, seeds app_config
 * defaults, and auto-populates poems/sutras/chars from JSON sources.
 *
 * Idempotent — every step checks for existing data and skips when present.
 * Returns rich stats so the /init wizard can render real progress.
 */
export async function POST() {
  return withErrorHandling(async () => {
    if (!(await isSetupRouteEnabled())) {
      return badRequest('setup_disabled', '/init is disabled.');
    }
    if (!process.env.DATABASE_URL) {
      return badRequest('db_not_configured', 'Configure DATABASE_URL first (Step 1).');
    }
    // Migrations first so tables added later (notes, notes_rate_limits, etc.)
    // exist when the wizard's progress sub-step claims they do.
    const { runMigrations } = await import('@/scripts/migrate');
    const migrations = await runMigrations();
    const { initDb } = await import('@/scripts/init-db');
    const stats = await initDb();
    return NextResponse.json({
      ok: true,
      data: {
        migrations: { files: migrations.files, statements: migrations.statements },
        stats,
      },
    });
  });
}
