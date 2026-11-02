import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import { setConfig } from '@/lib/config';
import { writeAudit } from '@/lib/audit';
import { normalizeSiteUrl, resolveSiteUrl } from '@/lib/seo/config';

const SiteUrlSchema = z.object({
  url: z.string().min(1).max(256),
});

export async function GET(_req: NextRequest) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    // `resolveSiteUrl` never throws: this endpoint reports what the site
    // URL is *currently*, and "nothing configured" is a valid answer.
    const { url, source } = await resolveSiteUrl();
    return NextResponse.json({ ok: true, data: { url, source } });
  });
}

export async function PATCH(req: NextRequest) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const parsed = SiteUrlSchema.safeParse(await req.json());
    if (!parsed.success) return badRequest('validation', parsed.error.message);
    const url = parsed.data.url.trim();
    if (!/^https?:\/\//.test(url) || url.length > 256) {
      return badRequest('validation', 'URL must start with http:// or https:// and be ≤256 chars');
    }
    // Store the canonical form: no trailing slash, and no `:443` / `:80`
    // when the port is the default for the scheme. What is stored has to
    // be what the admin screen shows back and what every consumer (the
    // canonical links, the sitemap, the MCP endpoint) reads — otherwise
    // the value on the screen and the value in the table disagree.
    const canonicalUrl = normalizeSiteUrl(url);
    try {
      await setConfig('site.url', canonicalUrl, auth.user.id);
    } catch (err) {
      return badRequest('validation', (err as Error).message);
    }
    await writeAudit({
      userId: auth.user.id,
      event: 'site_url_updated',
      metadata: { url: canonicalUrl },
    });
    return NextResponse.json({ ok: true, data: { url: canonicalUrl, source: 'app_config' as const } });
  });
}
