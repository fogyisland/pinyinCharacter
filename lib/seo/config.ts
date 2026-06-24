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
const FALLBACK = 'http://localhost:3000';

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
  const override = await getConfig('site.url');
  if (override && override.length > 0) {
    return override.replace(/\/+$/, '');
  }
  return getSiteUrl(env);
}

export function buildCanonicalUrl(path: string, env: NodeJS.ProcessEnv = process.env): string {
  if (/^https?:\/\//.test(path)) return path;
  const leading = path.startsWith('/') ? path : `/${path}`;
  return `${getSiteUrl(env)}${leading}`;
}
