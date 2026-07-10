import { NextResponse } from 'next/server';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { isSetupRouteEnabled } from '@/lib/setup';

/**
 * /init phase 5c: backfill char_etymology rows for chars missing them.
 * After this phase, char_etymology.row count == chars.row count.
 * Idempotent (INSERT IGNORE).
 */
export async function POST() {
  return withErrorHandling(async () => {
    if (!(await isSetupRouteEnabled())) {
      return badRequest('setup_disabled', '/init is disabled.');
    }
    if (!process.env.DATABASE_URL) {
      return badRequest('db_not_configured', 'Configure DATABASE_URL first (Step 1).');
    }
    const { initCharEtymology } = await import('@/scripts/init-db');
    const stats = await initCharEtymology();
    return NextResponse.json({ ok: true, data: stats });
  });
}
