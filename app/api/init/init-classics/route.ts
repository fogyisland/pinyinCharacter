import { NextResponse } from 'next/server';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { isSetupRouteEnabled } from '@/lib/setup';

/**
 * /init phase 4b: auto-populate classics from data/classics-manifest.json +
 * data/classics/<slug>.json (196 books, file-only since 2026-07-10).
 * Idempotent (skip if classics already has rows).
 */
export async function POST() {
  return withErrorHandling(async () => {
    if (!(await isSetupRouteEnabled())) {
      return badRequest('setup_disabled', '/init is disabled.');
    }
    if (!process.env.DATABASE_URL) {
      return badRequest('db_not_configured', 'Configure DATABASE_URL first (Step 1).');
    }
    const { initClassics } = await import('@/scripts/init-db');
    const stats = await initClassics();
    return NextResponse.json({ ok: true, data: stats });
  });
}
