import { NextResponse } from 'next/server';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import {
  isSetupRouteEnabled,
  markSetupComplete,
  markInitWizardAdminDone,
} from '@/lib/setup';

/**
 * Step 3 of /init wizard. Runs three phases in order:
 *   1. initDb() — creates the 15 tables (idempotent CREATE IF NOT EXISTS),
 *      seeds app_config defaults, auto-populates poems/sutras/chars from JSON.
 *   2. runMigrations() — applies all SQL in scripts/migrations/ (idempotent).
 *      Brings older DBs up to the current schema.
 *   3. markSetupComplete() — flips setup.completed=true and locks /init.
 *
 * ## Why the tables are built BEFORE the migrations
 *
 * The order used to be the other way round, and that was a defect. The
 * migration files begin with `ALTER TABLE worksheets ...`, and on a
 * brand-new database `worksheets` does not exist yet — it is created by
 * `initDb()`. So `runMigrations()` died with
 *
 *     Error: Table 'pinyin.worksheets' doesn't exist
 *       at runMigrations (scripts/migrate.ts:39:36)
 *
 * **before** `initDb()` ever ran. Nothing was created, nothing was
 * imported, nothing was seeded — and because the failure happened
 * outside the route's own error handling, the wizard reported success
 * on a database that was completely empty.
 *
 * The only order in which both steps have what they need is:
 *
 *     tables → migrations → data
 *
 * `initDb()` is idempotent (`CREATE TABLE IF NOT EXISTS`), so running it
 * first on an existing database is a no-op; the migrations then bring
 * that database up to date. On a fresh database the tables exist by the
 * time the migrations run.
 *
 * It also writes the wizard's step-2 marker (`setup.wizard.admin_done`).
 * Step 2 could not write it — on a fresh install `app_config` does not
 * exist until `initDb()` runs just above — so this is where the marker
 * finally lands, and the "skip step 2 on re-entry" protection starts
 * working.
 *
 * A marker that cannot be written does NOT fail the seed: by this point
 * the tables exist and the admin account has been created, so the setup
 * really did succeed. It is logged instead of swallowed.
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
    // Tables first, then the migrations: the migration files ALTER tables
    // that `initDb()` creates, so on a fresh database the other order dies
    // with ER_NO_SUCH_TABLE before a single table exists.
    await initDb();
    const migrations = await runMigrations();
    const markerWritten = await writeWizardMarker();
    await markSetupComplete();
    return NextResponse.json({
      ok: true,
      data: {
        completed: true,
        migrationsApplied: migrations.files,
        statementsApplied: migrations.statements,
        markerWritten,
      },
    });
  });
}

/**
 * Write the step-2 marker, absorbing a failure so it cannot undo a seed
 * that already succeeded. The failure is logged — never silently dropped.
 */
async function writeWizardMarker(): Promise<boolean> {
  try {
    return await markInitWizardAdminDone();
  } catch (error) {
    const e = error as Error;
    console.error(
      '[init] the wizard step-2 marker could not be written; step 2 will be shown again on a later visit:',
      e.message,
    );
    return false;
  }
}
