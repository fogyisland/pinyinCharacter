import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import { writeAudit } from '@/lib/audit';
import { getWechatConfig, isWechatConfigured } from '@/lib/wechat-config';
import { sendTemplateMessage } from '@/lib/wechat-api';
import { validateTemplateData } from '@/lib/wechat-types';

export const dynamic = 'force-dynamic';

const TestSchema = z.object({
  openid: z.string().min(1).max(64),
  templateId: z.string().min(1).max(64),
  url: z.string().max(512).optional(),
  data: z.record(z.string(), z.object({ value: z.string().min(1).max(200) })),
});

/**
 * POST /api/admin/wechat/test
 *
 * Sends one template message to one openid — the way to check that the
 * credentials, the template id, and the field names all line up before
 * an announcement goes out to everybody.
 */
export async function POST(req: NextRequest) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const config = await getWechatConfig();
    if (!isWechatConfigured(config)) {
      return badRequest('not_configured', 'the WeChat account is not configured yet');
    }
    const parsed = TestSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return badRequest('validation', parsed.error.message);
    let data;
    try {
      data = validateTemplateData(parsed.data.data);
    } catch (error) {
      return badRequest('validation', error instanceof Error ? error.message : String(error));
    }
    try {
      await sendTemplateMessage(
        parsed.data.openid,
        parsed.data.templateId,
        data,
        parsed.data.url || null,
      );
    } catch (error) {
      return badRequest('send_failed', error instanceof Error ? error.message : String(error));
    }
    await writeAudit({
      userId: auth.user.id,
      event: 'wechat_test_sent',
      metadata: { title: '测试消息', openid: parsed.data.openid },
    });
    return NextResponse.json({ ok: true, data: { accepted: true } });
  });
}
