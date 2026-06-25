import { NextRequest, NextResponse } from 'next/server';

/**
 * Fresh-deploy gate only.
 *
 * When the system is fresh (DATABASE_URL not set), redirect all traffic
 * to /init. The activation lock check (lib/activation) lives in a server
 * component guard, not here, because middleware runs in the edge runtime
 * and can't import mysql2.
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

  // Fresh deploy: no DATABASE_URL yet → /init. The actual setup-completed
  // check (app_config flag) lives in /init's API routes.
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