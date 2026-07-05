import { NextResponse } from 'next/server';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { isSetupRouteEnabled } from '@/lib/setup';

/**
 * /init phase 1: create the 25-table base schema. Idempotent — re-runs are no-ops.
 */
export async function POST() {
  return withErrorHandling(async () => {
    if (!(await isSetupRouteEnabled())) {
      return badRequest('setup_disabled', '/init is disabled.');
    }
    if (!process.env.DATABASE_URL) {
      return badRequest('db_not_configured', 'Configure DATABASE_URL first (Step 1).');
    }
    const { initTables } = await import('@/scripts/init-db');
    const stats = await initTables();
    return NextResponse.json({ ok: true, data: stats });
  });
}