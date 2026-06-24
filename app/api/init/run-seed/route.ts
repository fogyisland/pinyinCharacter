import { NextResponse } from 'next/server';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { isSetupRouteEnabled, markSetupComplete } from '@/lib/setup';

/**
 * Step 3 of /init wizard. Runs initDb() which:
 *   - creates all 15 tables (idempotent CREATE IF NOT EXISTS)
 *   - seeds app_config defaults
 *   - auto-populates poems/sutras/chars from JSON sources
 * Then marks setup.completed=true so middleware stops redirecting to /init.
 *
 * Public: only callable when setup is incomplete OR setup.route_enabled=true.
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
    await initDb();
    await markSetupComplete();
    return NextResponse.json({ ok: true, data: { completed: true } });
  });
}