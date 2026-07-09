import { NextResponse } from 'next/server';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { isSetupRouteEnabled } from '@/lib/setup';

/**
 * /init phase 5b: auto-populate rare_chars from data/content/<char>.json
 * (1412 L3 chars with non-empty rare_meaning). Without this phase, the
 * /rare-chars page shows "字库为空" even though chars table is populated.
 * Added 2026-07-09 to fix "罕见字库为空" user feedback.
 *
 * Idempotent: skips when rare_chars already has rows.
 */
export async function POST() {
  return withErrorHandling(async () => {
    if (!(await isSetupRouteEnabled())) {
      return badRequest('setup_disabled', '/init is disabled.');
    }
    if (!process.env.DATABASE_URL) {
      return badRequest('db_not_configured', 'Configure DATABASE_URL first (Step 1).');
    }
    const { initRareChars } = await import('@/scripts/init-db');
    const stats = await initRareChars();
    return NextResponse.json({ ok: true, data: stats });
  });
}