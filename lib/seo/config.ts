/**
 * Site URL helpers for canonical links, sitemaps, and JSON-LD.
 *
 * `getSiteUrl()` reads NEXT_PUBLIC_SITE_URL (set from the admin backend UI,
 * not from .env — see memory `next-public-site-url-from-admin`). In dev /
 * test it falls back to http://localhost:3000 so local dev works without
 * any config. In production it throws if the env var is missing, because
 * emitting `localhost:3000` canonicals into Google Search Console would
 * be a real SEO bug — and we already have validateEnv() boot-checking
 * JWT_SECRET, COOKIE_SECURE, and DATABASE_URL; this extends the same
 * fail-fast pattern to SEO.
 *
 * `env` parameter is injectable for testability; production callers always
 * use the default (process.env).
 *
 * `getRuntimeSiteUrl()` is the async variant that should be used by
 * runtime callers (sitemaps, robots, JSON-LD, metadata). It first checks
 * `app_config.site.url` (set via the admin UI at /admin/settings/site-url)
 * and falls back to the sync `getSiteUrl(env)` if not configured. The
 * sync `getSiteUrl` is kept for testability and for any code path that
 * truly cannot be async.
 */
import { getConfig } from '@/lib/config';

export const SITE_NAME = '字·韵';
export const SITE_LOCALE = 'zh_CN';
export const FALLBACK = 'http://localhost:3000';

function isProd(env: NodeJS.ProcessEnv): boolean {
  return env.NODE_ENV === 'production';
}

export function getSiteUrl(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.NEXT_PUBLIC_SITE_URL || FALLBACK;
  if (!env.NEXT_PUBLIC_SITE_URL && isProd(env)) {
    throw new Error(
      'NEXT_PUBLIC_SITE_URL is not set in production — canonical URLs and sitemaps would emit localhost:3000. ' +
        'Set it via the admin backend UI (Settings → Site URL), not by editing .env.',
    );
  }
  return raw.replace(/\/+$/, '');
}

export async function getRuntimeSiteUrl(env: NodeJS.ProcessEnv = process.env): Promise<string> {
  // Try reading from app_config first (admin UI override). Wrap in try/catch
  // because this is called during `next build` prerender (e.g. /robots.txt,
  // /sitemap.xml) when DATABASE_URL is not yet set — the pool init throws,
  // and we want the build to succeed with a sensible fallback rather than
  // failing the whole build. At runtime (Next.js server start), DATABASE_URL
  // is set and the override works as designed.
  let override: string | null = null;
  try {
    override = await getConfig('site.url');
  } catch {
    override = null;
  }
  if (override && override.length > 0) {
    return override.replace(/\/+$/, '');
  }
  // No app_config entry. Fall back to env, but if env is also empty, return
  // the localhost FALLBACK rather than throwing — that way the static
  // prerender at build time succeeds. The strict prod-throw lives in
  // getSiteUrl() for direct callers (tests + any future code that wants it).
  // validateEnv() in lib/env.ts still warns at boot when the env var is
  // missing in production, which is the right "fail-loud" channel.
  if (env.NEXT_PUBLIC_SITE_URL) {
    return env.NEXT_PUBLIC_SITE_URL.replace(/\/+$/, '');
  }
  return FALLBACK.replace(/\/+$/, '');
}

export function buildCanonicalUrl(path: string, env: NodeJS.ProcessEnv = process.env): string {
  if (/^https?:\/\//.test(path)) return path;
  const leading = path.startsWith('/') ? path : `/${path}`;
  return `${getSiteUrl(env)}${leading}`;
}

/** Where the effective site URL came from. */
export type SiteUrlSource = 'app_config' | 'env' | 'unset';

export interface ResolvedSiteUrl {
  /** The effective site URL, or an empty string when nothing is configured. */
  url: string;
  /** Which source supplied the value. */
  source: SiteUrlSource;
}

/**
 * Resolve the effective site URL for the admin UI — without ever throwing.
 *
 * `getSiteUrl()` throws in production when `NEXT_PUBLIC_SITE_URL` is
 * missing. That fail-fast behaviour is right for the SEO paths that *must*
 * emit an absolute URL, but it is exactly wrong for the admin screen whose
 * whole job is to set that URL: the screen would 500 precisely when the
 * value it is meant to collect is missing, and the admin could never fill
 * it in. The GET `/api/admin/site-url` route had the same shape.
 *
 * Nothing in this repository writes `NEXT_PUBLIC_SITE_URL` (the admin PATCH
 * only writes `app_config.site.url`), so a production install that has
 * never been configured always lands in that state — the page that sets the
 * URL was unreachable.
 *
 * This resolver reads the same two sources as `getRuntimeSiteUrl()`, in the
 * same order (app_config first, env second), but reports `unset` instead of
 * silently falling back to `http://localhost:3000`: the admin needs to know
 * that canonical/sitemap URLs are currently emitting the placeholder.
 */
export async function resolveSiteUrl(): Promise<ResolvedSiteUrl> {
  let override: string | null = null;
  try {
    override = await getConfig('site.url');
  } catch {
    // A database blip must not take the admin screen down with it.
    override = null;
  }
  if (override && override.length > 0) {
    return { url: override.replace(/\/+$/, ''), source: 'app_config' };
  }
  const env = process.env.NEXT_PUBLIC_SITE_URL;
  if (env && env.length > 0) {
    return { url: env.replace(/\/+$/, ''), source: 'env' };
  }
  return { url: '', source: 'unset' };
}
