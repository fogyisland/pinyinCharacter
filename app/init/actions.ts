'use server';

import { cookies } from 'next/headers';

/**
 * Sets the long-lived `setup_completed=1` cookie so the cookie-only
 * middleware (Task 3) stops redirecting this browser back to /init.
 *
 * 10-year maxAge mirrors /api/init/mark-complete so any browser that
 * reaches the locked AlreadyDoneCard at least once is permanently
 * "trust this setup is done" for the cookie gate.
 *
 * Used by EnsureSetupCompletedCookie (a tiny client component mounted
 * alongside AlreadyDoneCard). Server Actions are the only way Next.js
 * 15.5+ allows cookie writes from a server-component page tree.
 */
export async function markSetupCompletedCookie(): Promise<void> {
  (await cookies()).set('setup_completed', '1', {
    path: '/',
    maxAge: 60 * 60 * 24 * 365 * 10, // 10 years
    sameSite: 'lax',
    httpOnly: false,
  });
}