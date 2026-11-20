import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import { writeAudit } from '@/lib/audit';
import { getWechatConfig, saveWechatConfig } from '@/lib/wechat-config';

export const dynamic = 'force-dynamic';

const ConfigSchema = z.object({
  enabled: z.boolean().optional(),
  appId: z.string().max(64).optional(),
  appSecret: z.string().max(256).optional(),
});

/**
 * GET /api/admin/wechat/config
 *
 * The configuration, without the secret. The admin screen only learns
 * WHETHER a secret is stored — the secret itself never comes back.
 */
export async function GET() {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const config = await getWechatConfig();
    return NextResponse.json({ ok: true, data: { config } });
  });
}

/**
 * PUT /api/admin/wechat/config
 *
 * An empty app secret keeps the stored one — the admin screen sends an
 * empty string when the field was left alone.
 */
export async function PUT(req: NextRequest) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const parsed = ConfigSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return badRequest('validation', parsed.error.message);
    try {
      await saveWechatConfig(parsed.data, auth.user.id);
    } catch (error) {
      return badRequest('validation', error instanceof Error ? error.message : String(error));
    }
    await writeAudit({
      userId: auth.user.id,
      event: 'wechat_config_updated',
      metadata: { title: '微信配置', keys: Object.keys(parsed.data) },
    });
    const config = await getWechatConfig();
    return NextResponse.json({ ok: true, data: { config } });
  });
}
