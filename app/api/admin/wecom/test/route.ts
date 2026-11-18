import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import { writeAudit } from '@/lib/audit';
import { listWebhooks } from '@/lib/wecom-webhooks';
import { pushWecomDelivery } from '@/lib/wecom-deliver';

export const dynamic = 'force-dynamic';

const TestSchema = z.object({ webhookId: z.number().int().positive() });

export async function POST(req: NextRequest) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const parsed = TestSchema.safeParse(await req.json());
    if (!parsed.success) return badRequest('validation', parsed.error.message);
    const groups = await listWebhooks();
    const group = groups.find((g) => g.id === parsed.data.webhookId);
    if (!group) return badRequest('not_found', 'group not found');
    const result = await pushWecomDelivery(
      {
        id: 0,
        webhookId: group.id,
        category: 'admin_alert',
        subject: '企业微信转发测试',
        body: '这是一条测试消息。看到它就说明转发链路是通的。',
        status: 'pending',
        attempts: 0,
        lastError: null,
        nextAttemptAt: new Date(),
        sentAt: null,
        createdAt: new Date(),
      },
      group.webhookUrl,
    );
    if (!result.ok) {
      return badRequest('wecom_error', result.error ?? 'push failed');
    }
    await writeAudit({
      userId: auth.user.id,
      event: 'wecom_test_sent',
      metadata: { webhookId: group.id, name: group.name },
    });
    return NextResponse.json({ ok: true, data: { sent: true } });
  });
}
