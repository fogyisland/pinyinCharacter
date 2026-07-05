import { NextResponse } from 'next/server';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { isSetupRouteEnabled } from '@/lib/setup';

/**
 * /init phase 2: seed app_config defaults (ai.* + tts.* + era fonts).
 * Idempotent — era fonts always upsert, ai/tts skip if app_config already has rows.
 */
export async function POST() {
  return withErrorHandling(async () => {
    if (!(await isSetupRouteEnabled())) {
      return badRequest('setup_disabled', '/init is disabled.');
    }
    if (!process.env.DATABASE_URL) {
      return badRequest('db_not_configured', 'Configure DATABASE_URL first (Step 1).');
    }
    const { initAppConfig } = await import('@/scripts/init-db');
    const stats = await initAppConfig();
    return NextResponse.json({ ok: true, data: stats });
  });
}