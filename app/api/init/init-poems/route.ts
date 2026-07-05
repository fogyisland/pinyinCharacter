import { NextResponse } from 'next/server';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { isSetupRouteEnabled } from '@/lib/setup';

/**
 * /init phase 3: auto-populate poems from data/poems/*.json. Idempotent (skip if
 * poems table has rows).
 */
export async function POST() {
  return withErrorHandling(async () => {
    if (!(await isSetupRouteEnabled())) {
      return badRequest('setup_disabled', '/init is disabled.');
    }
    if (!process.env.DATABASE_URL) {
      return badRequest('db_not_configured', 'Configure DATABASE_URL first (Step 1).');
    }
    const { initPoems } = await import('@/scripts/init-db');
    const stats = await initPoems();
    return NextResponse.json({ ok: true, data: stats });
  });
}