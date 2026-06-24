import { NextRequest, NextResponse } from 'next/server';

/**
 * Setup wizard gate.
 *
 * When the system is fresh (DATABASE_URL not set OR app_config.setup.completed
 * missing), redirect all traffic to /init. After setup completes, this becomes
 * a no-op and the normal auth flow takes over.
 *
 * The check runs in the edge runtime (middleware cannot use mysql2 directly),
 * so we just probe for DATABASE_URL presence in process.env. The deeper check
 * (app_config flag) lives in /init's API routes and /admin/init's checklist.
 *
 * Allow-list: /init itself, Next.js internals (_next/, api/init/*), and
 * static assets. Everything else redirects to /init on a fresh deploy.
 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Always allow /init (the wizard) and its API routes
  if (pathname === '/init' || pathname.startsWith('/api/init/')) {
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

  // Detect fresh deploy: no DATABASE_URL yet, or app hasn't been initialized.
  // We can't query DB from middleware, so we just check process.env. The
  // actual /init form will discover the missing tables on its own.
  if (!process.env.DATABASE_URL) {
    const url = req.nextUrl.clone();
    url.pathname = '/init';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // Run middleware on every route except static assets and Next internals
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};