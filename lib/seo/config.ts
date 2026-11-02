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

/**
 * The default port for a scheme — the one that never has to be written out.
 * The keys are scheme names WITHOUT the colon, because that is what the
 * authority parser below hands over.
 */
const DEFAULT_PORTS: Record<string, string> = { https: '443', http: '80' };

/**
 * Put a site URL into its canonical form: no trailing slash, and no port
 * when the port is the default for the scheme.
 *
 * `https://ziyun.pudafo.com:443` and `https://ziyun.pudafo.com` are the same
 * origin, but they are two different strings — and this one string is
 * pasted into the canonical links, the sitemap, the JSON-LD, the
 * verification e-mails and the MCP endpoint. A redundant `:443` in the
 * canonical URL is a duplicate-page signal to a search engine, and
 * `https://host:443/mcp` is not the endpoint an operator means to publish.
 *
 * A **non-default** port is meaningful and survives: the dev server on 4444,
 * a staging box on 8443.
 *
 * A value that is not a parseable URL is returned untouched — the admin can
 * type anything, and a value we cannot parse must not be mangled into
 * something else.
 *
 * The port is removed by rewriting the string, not by leaning on the
 * `URL` parser: `new URL('https://host:443').port` is already `''` (the
 * parser drops a default port on its own), so a rule written in terms of
 * `.port` would be a silent no-op that only looks correct. Matching the
 * authority text directly keeps the rule visible and testable.
 */
export function normalizeSiteUrl(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return trimmed;

  const match = /^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)([^/?#]*)(.*)$/.exec(trimmed);
  if (!match) {
    // Not a URL we can reason about (or not a URL at all). Keep the value
    // as it was — only the trailing slashes are removed.
    return trimmed.replace(/\/+$/, '');
  }

  const [, schemePrefix, authority, rest] = match;
  const scheme = schemePrefix.slice(0, -'://'.length).toLowerCase();
  const defaultPort = DEFAULT_PORTS[scheme];

  // The authority is `[userinfo@]host[:port]`.
  const atSign = authority.lastIndexOf('@');
  const userInfo = atSign === -1 ? '' : authority.slice(0, atSign + 1);
  const hostAndPort = atSign === -1 ? authority : authority.slice(atSign + 1);

  // An IPv6 host is bracketed and may contain colons of its own, so the
  // port is looked for AFTER the closing bracket. An unbracketed host has
  // exactly one colon, if it has a port at all.
  let host: string;
  let portPart: string;
  if (hostAndPort.startsWith('[')) {
    const closingBracket = hostAndPort.indexOf(']');
    if (closingBracket === -1) {
      // A malformed IPv6 literal — leave it alone rather than guess.
      return trimmed.replace(/\/+$/, '');
    }
    host = hostAndPort.slice(0, closingBracket + 1);
    portPart = hostAndPort.slice(closingBracket + 1);
  } else {
    const colon = hostAndPort.indexOf(':');
    if (colon === -1) {
      host = hostAndPort;
      portPart = '';
    } else {
      host = hostAndPort.slice(0, colon);
      portPart = hostAndPort.slice(colon);
    }
  }

  const portMatch = /^:(\d+)$/.exec(portPart);
  if (!portMatch || !defaultPort || portMatch[1] !== defaultPort) {
    // Either there is no port, or the port is not the default for this
    // scheme — in both cases the url is already canonical, and a
    // non-default port (the dev server on 4444) must survive.
    return trimmed.replace(/\/+$/, '');
  }

  return `${schemePrefix}${userInfo}${host}${rest}`.replace(/\/+$/, '');
}

export function getSiteUrl(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.NEXT_PUBLIC_SITE_URL || FALLBACK;
  if (!env.NEXT_PUBLIC_SITE_URL && isProd(env)) {
    throw new Error(
      'NEXT_PUBLIC_SITE_URL is not set in production — canonical URLs and sitemaps would emit localhost:3000. ' +
        'Set it via the admin backend UI (Settings → Site URL), not by editing .env.',
    );
  }
  return normalizeSiteUrl(raw);
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
  } catch (error) {
    override = null;
    // The build-time case (no DATABASE_URL yet) is expected and needs no
    // noise; a failure at RUNTIME is not, and it would otherwise be a
    // silent fallback to localhost — the operator would never learn that
    // the site has been emitting placeholder URLs.
    if (process.env.DATABASE_URL) {
      console.error(
        '[seo] the site.url override could not be read — falling back to the environment:',
        error,
      );
    }
  }
  if (override && override.length > 0) {
    return normalizeSiteUrl(override);
  }
  // No app_config entry. Fall back to env, but if env is also empty, return
  // the localhost FALLBACK rather than throwing — that way the static
  // prerender at build time succeeds. The strict prod-throw lives in
  // getSiteUrl() for direct callers (tests + any future code that wants it).
  // validateEnv() in lib/env.ts still warns at boot when the env var is
  // missing in production, which is the right "fail-loud" channel.
  if (env.NEXT_PUBLIC_SITE_URL) {
    return normalizeSiteUrl(env.NEXT_PUBLIC_SITE_URL);
  }
  return normalizeSiteUrl(FALLBACK);
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
  } catch (error) {
    // A database blip must not take the admin screen down with it. It is
    // still logged when a database is configured at all, because "the
    // admin screen shows 'unset' while the site is serving URLs" is a
    // state the operator needs to know about.
    override = null;
    if (process.env.DATABASE_URL) {
      console.error('[seo] the site.url override could not be read:', error);
    }
  }
  if (override && override.length > 0) {
    return { url: normalizeSiteUrl(override), source: 'app_config' };
  }
  const env = process.env.NEXT_PUBLIC_SITE_URL;
  if (env && env.length > 0) {
    return { url: normalizeSiteUrl(env), source: 'env' };
  }
  return { url: '', source: 'unset' };
}
