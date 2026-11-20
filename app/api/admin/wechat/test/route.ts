import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import { writeAudit } from '@/lib/audit';
import { getWechatConfig, isWechatConfigured } from '@/lib/wechat-config';
import { sendTemplateMessage } from '@/lib/wechat-api';
import { validateTemplateData } from '@/lib/wechat-types';
import { translateWechatApiError } from '@/lib/wechat-api-error';
import { resolveWechatJumpUrlForSite } from '@/lib/wechat-jump-url';

export const dynamic = 'force-dynamic';

const TestSchema = z.object({
  openid: z.string().min(1).max(64),
  templateId: z.string().min(1).max(64),
  url: z.string().max(512).optional(),
  // The precise limit depends on the field type and is checked by
  // `validateTemplateData`; this cap only stops a huge payload.
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
    if (!parsed.success) return badRequest('validation', parsed.error.issues[0]?.message ?? 'bad input');
    let data;
    try {
      data = validateTemplateData(parsed.data.data);
    } catch (error) {
      return badRequest('validation', error instanceof Error ? error.message : String(error));
    }
    // The jump url goes into the message, and the follower taps it — it
    // must point at THIS site, or it is a phishing link wearing our
    // official account's name.
    let url: string | null = null;
    if (parsed.data.url) {
      url = await resolveWechatJumpUrlForSite(parsed.data.url);
      if (url === null) {
        return badRequest(
          'validation',
          "the jump url must be a path on this site, or an address on this site's own domain",
        );
      }
    }
    try {
      await sendTemplateMessage(
        parsed.data.openid,
        parsed.data.templateId,
        data,
        url,
      );
    } catch (error) {
      // A WeChat failure gets the same actionable answer as the follower
      // count: the errcode and what to change, not a raw message.
      const translated = translateWechatApiError(error);
      if (translated) {
        return NextResponse.json(
          { ok: false, error: { code: translated.code, message: translated.message } },
          { status: translated.status ?? 500 },
        );
      }
      return badRequest('send_failed', error instanceof Error ? error.message : String(error));
    }
    await writeAudit({
      userId: auth.user.id,
      event: 'wechat_test_sent',
      metadata: { title: '测试消息', openid: parsed.data.openid },
    });
    return NextResponse.json({ ok: true, data: { accepted: true } });
  }, undefined, translateWechatApiError);
}
