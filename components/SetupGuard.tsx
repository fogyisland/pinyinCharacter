import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import type { ReactNode } from 'react';
import { getSetupState } from '@/lib/setup';

/**
 * Server-component gate for "has this install been initialized yet?".
 *
 * Sits inside the root layout, next to ActivationGuard. The middleware
 * cannot do this check: it runs on the edge runtime, where mysql2 is not
 * available, so it can only look at the `setup_completed` cookie. That
 * cookie is a browser-held hint and it goes stale — after a redeploy
 * against a fresh database the browser still says "setup is done" while
 * the new database has no tables at all. The symptom is exactly what we
 * saw in production: every DB-backed endpoint answered 500 and the
 * wizard was never reached, because the stale cookie waved the request
 * through.
 *
 * This guard re-asks the server. `getSetupState()` is the authoritative
 * answer:
 *
 *   'complete'   → render normally
 *   'incomplete' → redirect to /init (the wizard's orchestrator decides
 *                  which screen to show)
 *   'unknown'    → the database could not be reached; render normally.
 *                  Losing the site because the DB blinked is worse than
 *                  showing a half-broken page, and /init cannot help
 *                  either — its first step needs the very DB that is
 *                  unreachable.
 *
 * Loop prevention: /init (and everything under it) is skipped, so the
 * wizard can always render — including the case where the user landed
 * here *because* setup is incomplete.
 */
export async function SetupGuard({ children }: { children: ReactNode }) {
  // The middleware stamps the requested path onto the request headers.
  const h = await headers();
  const pathname = h.get('x-pathname') ?? '';

  // No path known → we cannot tell whether this IS /init, and redirecting
  // blind risks a loop. Render and let the page itself decide.
  if (!pathname) return <>{children}</>;

  // The wizard must always render.
  if (pathname === '/init' || pathname.startsWith('/init/')) {
    return <>{children}</>;
  }

  const state = await getSetupState();
  if (state === 'incomplete') {
    redirect('/init');
  }
  return <>{children}</>;
}
