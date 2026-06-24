import { NextResponse } from 'next/server';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { isSetupRouteEnabled } from '@/lib/setup';

/**
 * Phase 3a of /init wizard. Runs all SQL migrations in scripts/migrations/.
 * Idempotent — safe to re-run. Returns counts so the UI can show progress.
 */
export async function POST() {
  return withErrorHandling(async () => {
    if (!(await isSetupRouteEnabled())) {
      return badRequest('setup_disabled', '/init is disabled.');
    }
    if (!process.env.DATABASE_URL) {
      return badRequest('db_not_configured', 'Configure DATABASE_URL first (Step 1).');
    }
    const { runMigrations } = await import('@/scripts/migrate');
    const result = await runMigrations();
    return NextResponse.json({ ok: true, data: result });
  });
}