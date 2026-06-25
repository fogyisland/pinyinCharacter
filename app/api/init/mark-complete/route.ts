import { NextResponse } from 'next/server';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { isSetupRouteEnabled, markSetupComplete } from '@/lib/setup';

/**
 * Phase 3c of /init wizard. Final step — flips setup.completed=true and
 * locks /init. Must run AFTER migrate + initDb succeed.
 *
 * Also sets a long-lived `setup_completed=1` cookie so the edge-runtime
 * middleware (which can't read .env or hit MySQL) knows to stop redirecting
 * traffic to /init. Without this cookie, the middleware would keep
 * redirecting to /init because it was started before .env existed.
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
    const res = NextResponse.json({ ok: true, data: { completed: true } });
    // 10 years — effectively permanent. Allows middleware to skip the
    // /init redirect for this browser without a server roundtrip.
    res.cookies.set('setup_completed', '1', {
      path: '/',
      maxAge: 60 * 60 * 24 * 365 * 10,
      sameSite: 'lax',
      httpOnly: false,
    });
    return res;
  });
}