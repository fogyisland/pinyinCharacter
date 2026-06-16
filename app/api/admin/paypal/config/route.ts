import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import { getConfig, setConfigBatch } from '@/lib/config';
import { writeAudit } from '@/lib/audit';

const PayPalConfigSchema = z.object({
  mode: z.enum(['sandbox', 'live']).optional(),
  clientId: z.string().min(1).max(128).optional(),
  clientSecret: z.string().min(1).max(256).optional(),
  webhookId: z.string().min(1).max(128).optional(),
});

export async function GET(req: NextRequest) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const [mode, clientId, clientSecret, webhookId] = await Promise.all([
      getConfig('paypal.mode'),
      getConfig('paypal.client_id'),
      getConfig('paypal.client_secret'),
      getConfig('paypal.webhook_id'),
    ]);
    const origin = new URL(req.url).origin;
    return NextResponse.json({
      ok: true,
      data: {
        mode: (mode ?? 'sandbox') as 'sandbox' | 'live',
        hasClientId: !!clientId,
        hasSecret: !!clientSecret,
        hasWebhookId: !!webhookId,
        webhookUrl: `${origin}/api/webhooks/paypal`,
      },
    });
  });
}

export async function PUT(req: NextRequest) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const parsed = PayPalConfigSchema.safeParse(await req.json());
    if (!parsed.success) return badRequest('validation', parsed.error.message);
    const updates: Record<string, string> = {};
    if (parsed.data.mode) updates['paypal.mode'] = parsed.data.mode;
    if (parsed.data.clientId) updates['paypal.client_id'] = parsed.data.clientId;
    if (parsed.data.clientSecret) updates['paypal.client_secret'] = parsed.data.clientSecret;
    if (parsed.data.webhookId) updates['paypal.webhook_id'] = parsed.data.webhookId;
    if (Object.keys(updates).length === 0) return badRequest('empty', 'no fields to update');

    await setConfigBatch(updates, auth.user.id);
    await writeAudit({
      userId: auth.user.id,
      event: 'paypal_config_updated',
      metadata: { changed: Object.keys(updates) },
    });
    const [mode] = await Promise.all([getConfig('paypal.mode')]);
    return NextResponse.json({
      ok: true,
      data: {
        mode: (mode ?? 'sandbox') as 'sandbox' | 'live',
        changed: Object.keys(updates),
      },
    });
  });
}
