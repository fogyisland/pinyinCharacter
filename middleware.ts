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
 * Whitelist: /init, /init/*, /api/init/*, /mcp, Next.js internals, static assets.
 * Everything else: redirect to /init if cookie not set.
 */

/**
 * Asset paths that must never be redirected.
 *
 * A 307 on /font/fonts.css is worse than it looks: the stylesheet is
 * render-blocking, so the browser would follow the redirect, fetch /init's
 * HTML, fail to parse it as CSS and drop the stylesheet — the page would
 * render with system fonts instead of the site's own. The same redirect
 * hides /robots.txt and the sitemaps from crawlers, and it costs an extra
 * round trip for every font file, stroke JSON and icon.
 */
const STATIC_ASSET_PREFIXES = [
  '/_next/',
  '/font/',
  '/fonts/',
  '/strokes/',
  '/favicon',
  '/icon',
  '/apple-icon',
  '/sitemap',
] as const;

const STATIC_ASSET_FILES = new Set([
  '/logo.png',
  '/logo.svg',
  '/logo-sm.webp',
  '/logo-sm.png',
  '/manifest.json',
  '/robots.txt',
]);

/** True for asset paths the setup gate must let through untouched. */
function isStaticAsset(pathname: string): boolean {
  if (STATIC_ASSET_FILES.has(pathname)) return true;
  return STATIC_ASSET_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Always allow /init (the wizard + its 3 screens) and its API routes
  if (pathname === '/init' || pathname.startsWith('/init/')) {
    return NextResponse.next();
  }
  if (pathname.startsWith('/api/init/')) {
    return NextResponse.next();
  }

  // MCP clients do not carry browser cookies — they present a bearer token
  // instead — so /mcp has to pass the cookie gate.
  if (pathname === '/mcp') {
    return NextResponse.next();
  }

  // Allow Next.js internals and static assets
  if (isStaticAsset(pathname)) {
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
  // Run middleware on every route except static assets and Next internals.
  // The asset paths are excluded here as well as in the function above so
  // the edge runtime is not even invoked for them.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|font/|fonts/|strokes/|logo\\.png|logo\\.svg|logo-sm\\.webp|logo-sm\\.png|manifest\\.json|robots\\.txt|sitemap).*)',
  ],
};
