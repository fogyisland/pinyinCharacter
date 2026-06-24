import { NextResponse } from 'next/server';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { isSetupRouteEnabled, markSetupComplete } from '@/lib/setup';

/**
 * Phase 3c of /init wizard. Final step — flips setup.completed=true and
 * locks /init. Must run AFTER migrate + initDb succeed.
 */
export async function POST() {
  return withErrorHandling(async () => {
    if (!(await isSetupRouteEnabled())) {
      return badRequest('setup_disabled', '/init is disabled.');
    }
    if (!process.env.DATABASE_URL) {
      return badRequest('db_not_configured', 'Configure DATABASE_URL first (Step 1).');
    }
    await markSetupComplete();
    return NextResponse.json({ ok: true, data: { completed: true } });
  });
}