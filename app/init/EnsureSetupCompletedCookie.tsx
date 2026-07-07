'use client';

import { useEffect } from 'react';
import { markSetupCompletedCookie } from './actions';

/**
 * Invisible client component that fires the markSetupCompletedCookie
 * Server Action on mount. Mounted by the /init RSC orchestrator next to
 * AlreadyDoneCard so a fresh browser that lands on /init after setup is
 * complete picks up the `setup_completed=1` cookie without bouncing
 * through the wizard.
 *
 * Next.js 15.5 forbids `cookies().set()` from server components — the
 * Server Action path is the legitimate workaround.
 */
export function EnsureSetupCompletedCookie() {
  useEffect(() => {
    markSetupCompletedCookie().catch(() => {
      // Non-fatal: the locked card still renders, but the cookie may
      // not be set on this visit. The next navigation (e.g. clicking
      // "前往登录") will re-hit /init and retry.
    });
  }, []);
  return null;
}
