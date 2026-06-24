import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import { getConfig, setConfig } from '@/lib/config';
import { writeAudit } from '@/lib/audit';
import { getSiteUrl } from '@/lib/seo/config';

const SiteUrlSchema = z.object({
  url: z.string().min(1).max(256),
});

export async function GET(_req: NextRequest) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const override = await getConfig('site.url');
    if (override && override.length > 0) {
      return NextResponse.json({
        ok: true,
        data: { url: override, source: 'app_config' as const },
      });
    }
    return NextResponse.json({
      ok: true,
      data: { url: getSiteUrl(), source: 'env' as const },
    });
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
    try {
      await setConfig('site.url', url, auth.user.id);
    } catch (err) {
      return badRequest('validation', (err as Error).message);
    }
    await writeAudit({
      userId: auth.user.id,
      event: 'site_url_updated',
      metadata: { url },
    });
    return NextResponse.json({ ok: true, data: { url, source: 'app_config' as const } });
  });
}
