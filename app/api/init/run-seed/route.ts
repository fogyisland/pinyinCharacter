import { NextResponse } from 'next/server';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { isSetupRouteEnabled, markSetupComplete } from '@/lib/setup';

/**
 * Step 3 of /init wizard. Runs three phases in order:
 *   1. runMigrations() — applies all SQL in scripts/migrations/ (idempotent).
 *      Brings older DBs up to current schema before initDb populates them.
 *   2. initDb() — creates the 15 tables (idempotent CREATE IF NOT EXISTS),
 *      seeds app_config defaults, auto-populates poems/sutras/chars from JSON.
 *   3. markSetupComplete() — flips setup.completed=true and locks /init.
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
    const { runMigrations } = await import('@/scripts/migrate');
    const { initDb } = await import('@/scripts/init-db');
    const migrations = await runMigrations();
    await initDb();
    await markSetupComplete();
    return NextResponse.json({
      ok: true,
      data: {
        completed: true,
        migrationsApplied: migrations.files,
        statementsApplied: migrations.statements,
      },
    });
  });
}