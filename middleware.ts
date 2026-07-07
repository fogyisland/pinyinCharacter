import { NextRequest, NextResponse } from 'next/server';

/**
 * Cookie-only setup gate.
 *
 * With the 3-URL wizard in place, the *only* signal middleware has about
 * whether setup is done is the `setup_completed=1` cookie set by:
 *   1. `/api/init/mark-complete` when step 3 succeeds, OR
 *   2. The /init orchestrator when a fresh browser lands on /init after
 *      setup is already complete (breaks the redirect loop).
 *
 * Edge runtime can't import mysql2 to query app_config directly, so the
 * cookie is the sole gate. The /init page itself does a server-side check
 * via `/api/init/status` for the locked UI.
 *
 * Whitelist: /init, /init/*, /api/init/*, Next.js internals, static assets.
 * Everything else: redirect to /init if cookie not set.
 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Always allow /init (the wizard + its 3 screens) and its API routes
  if (pathname === '/init' || pathname.startsWith('/init/')) {
    return NextResponse.next();
  }
  if (pathname.startsWith('/api/init/')) {
    return NextResponse.next();
  }

  // Allow Next.js internals and static assets
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.startsWith('/icon') ||
    pathname.startsWith('/apple-icon')
  ) {
    return NextResponse.next();
  }

  // Cookie gate: trust `setup_completed=1` to mean setup is done.
  if (req.cookies.get('setup_completed')?.value === '1') {
    return NextResponse.next();
  }

  // Otherwise, force the wizard.
  const url = req.nextUrl.clone();
  url.pathname = '/init';
  return NextResponse.redirect(url);
}

export const config = {
  // Run middleware on every route except static assets and Next internals
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};