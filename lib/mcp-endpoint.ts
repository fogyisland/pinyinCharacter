import { FALLBACK, getRuntimeSiteUrl } from './seo/config';

/**
 * The public URL of the MCP endpoint.
 *
 * `getRuntimeSiteUrl()` knows the production URL (the admin-configured
 * site.url, or NEXT_PUBLIC_SITE_URL). It falls back to the localhost
 * placeholder when neither is set — and the dev server runs on 4444,
 * not 3000, so the placeholder would hand out a URL that does not work.
 *
 * So: a configured site URL wins; otherwise the request's own origin
 * wins; and with no request at all (the server component on /profile)
 * the dev server's own PORT is used.
 */
export async function resolveMcpEndpoint(req?: { url: string }): Promise<string> {
  const siteUrl = await getRuntimeSiteUrl();
  if (siteUrl !== FALLBACK) return `${siteUrl}/mcp`;
  if (req) return `${new URL(req.url).origin}/mcp`;
  return `http://localhost:${process.env.PORT ?? '3000'}/mcp`;
}
