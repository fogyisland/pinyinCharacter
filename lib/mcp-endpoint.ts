import { FALLBACK, getRuntimeSiteUrl } from './seo/config';

/**
 * The origin of a request url, when the url has one.
 *
 * `req.url` is often a relative path ('/mcp'), which `new URL` rejects with
 * a TypeError. A caller is allowed to pass one, so a url that cannot be
 * parsed must not take the request down: it simply yields no origin, and
 * the caller falls back.
 */
function readOrigin(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

/**
 * The public URL of the MCP endpoint.
 *
 * `getRuntimeSiteUrl()` knows the production URL (the admin-configured
 * site.url, or NEXT_PUBLIC_SITE_URL). It falls back to the localhost
 * placeholder when neither is set — and the dev server runs on 4444,
 * not 3000, so the placeholder would hand out a URL that does not work.
 *
 * So: a configured site URL wins; otherwise the request's own origin
 * wins; and with no usable origin (no request at all, as in the server
 * component on /profile, or a relative request url) the dev server's own
 * PORT is used.
 */
export async function resolveMcpEndpoint(req?: { url: string }): Promise<string> {
  const siteUrl = await getRuntimeSiteUrl();
  if (siteUrl !== FALLBACK) return `${siteUrl}/mcp`;
  const origin = readOrigin(req?.url);
  if (origin) return `${origin}/mcp`;
  return `http://localhost:${process.env.PORT ?? '3000'}/mcp`;
}
