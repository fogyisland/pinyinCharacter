import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import { writeAudit } from '@/lib/audit';
import { getWechatConfig, saveWechatConfig } from '@/lib/wechat-config';
import { isValidWechatAppId } from '@/lib/wechat-types';

export const dynamic = 'force-dynamic';

const ConfigSchema = z.object({
  enabled: z.boolean().optional(),
  // An empty string CLEARS the app id — the store treats "" as an
  // explicit unset, and `undefined` as "the field was not sent".
  appId: z
    .string()
    .max(64)
    .refine((value) => value === '' || isValidWechatAppId(value), {
      message: 'the WeChat app id does not look like a WeChat app id',
    })
    .optional(),
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
    if (!parsed.success) return badRequest('validation', parsed.error.issues[0]?.message ?? 'bad input');
    // ⚠️ No try/catch here on purpose: a store failure is a SERVER
    // error, not a validation error. Swallowing it into a 400 would tell
    // the admin their AppID was wrong when the database was down.
    await saveWechatConfig(parsed.data, auth.user.id);
    await writeAudit({
      userId: auth.user.id,
      event: 'wechat_config_updated',
      metadata: { title: '微信配置', keys: Object.keys(parsed.data) },
    });
    const config = await getWechatConfig();
    return NextResponse.json({ ok: true, data: { config } });
  });
}
