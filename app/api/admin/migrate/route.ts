import { NextResponse } from 'next/server';
import { withErrorHandling } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import { writeAudit } from '@/lib/audit';
import { compareSchema, clearSchemaCache } from '@/lib/schema-check';

export const dynamic = 'force-dynamic';

/**
 * The schema migration screen's API.
 *
 * ## Why this route exists
 *
 * The only other caller of `runMigrations()` is the `/init` wizard
 * (`/api/init/migrate` and `/api/init/run-seed`). The wizard locks
 * itself out once setup completes — `markSetupComplete()` writes
 * `setup.route_enabled = 'false'` and `isSetupRouteEnabled()` only opens
 * the door for the literal string `'true'`.
 *
 * So an operator who copies new code onto a running server has **no way
 * to apply the migrations that came with it**. The schema stays behind
 * the code, and the affected features fail with `ER_NO_SUCH_TABLE` while
 * the pages that do not touch the new tables keep working — which is the
 * shape of the "schema behind code" failure: a site that looks alive and
 * is quietly broken in one area.
 *
 * ## The security difference from the wizard's route
 *
 * `/api/init/migrate` is guarded by `isSetupRouteEnabled()` and nothing
 * else. That is sound there because the wizard closes itself after the
 * first install. This route is open on a live site, so it is guarded by
 * `requireAdmin()`: an administrator check, not a setup-state check.
 * Running DDL is not something an unauthenticated caller should be able
 * to trigger.
 *
 * ## What the response reports
 *
 * The migrations are idempotent — each file checks `information_schema`
 * itself — so running them twice is harmless and this route can be
 * pressed as often as the operator likes. `GET` reports what the
 * database is missing by name (from `lib/schema-check.ts`); `POST` runs
 * the migrations and reports the comparison again afterwards, so the
 * screen shows the state *after* the migration rather than before it.
 */
export async function GET() {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const comparison = await compareSchema();
    return NextResponse.json({ ok: true, data: { comparison } });
  });
}

export async function POST() {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { runMigrations } = await import('@/scripts/migrate');

    let migrations: { files: number; statements: number };
    try {
      migrations = await runMigrations();
    } catch (error) {
      // A migration that aborts halfway leaves the schema in a state
      // neither the old nor the new code fully expects, so the failure
      // has to reach the operator with the database's own words. The
      // generic `withErrorHandling` envelope would replace it with
      // "server error", which tells nobody anything.
      const message = error instanceof Error ? error.message : String(error);
      console.error('[api] schema migration failed:', message);
      await writeAudit({
        userId: auth.user.id,
        event: 'admin_schema_migrate',
        metadata: { title: '运行数据库结构迁移', failed: message },
      });
      // The probe cache is cleared anyway: the schema may be half
      // applied, and a cached answer from before the attempt would be
      // actively misleading.
      clearSchemaCache();
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: 'migration_failed',
            message: `结构迁移失败: ${message}`,
          },
        },
        { status: 500 },
      );
    }

    // The probe was cached from before the migration. Clear it so the
    // comparison below reflects what the migration actually did.
    clearSchemaCache();
    const comparison = await compareSchema();

    await writeAudit({
      userId: auth.user.id,
      event: 'admin_schema_migrate',
      metadata: {
        title: '运行数据库结构迁移',
        files: migrations.files,
        statements: migrations.statements,
        missingTables: comparison.missingTables.length,
        missingColumns: comparison.missingColumns.length,
      },
    });

    return NextResponse.json({ ok: true, data: { migrations, comparison } });
  });
}
