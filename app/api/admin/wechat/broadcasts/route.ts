import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import { writeAudit } from '@/lib/audit';
import { createBroadcast, listBroadcasts, queueBroadcast } from '@/lib/wechat-broadcasts';
import { validateTemplateData } from '@/lib/wechat-types';
import { resolveWechatJumpUrlForSite } from '@/lib/wechat-jump-url';
import { getWechatConfig, isWechatConfigured } from '@/lib/wechat-config';

export const dynamic = 'force-dynamic';

// The precise limit depends on the field type and is checked by
// `validateTemplateData`; this cap only stops a huge payload.
const TemplateValueSchema = z.object({ value: z.string().min(1).max(200) });

const BroadcastSchema = z.object({
  title: z.string().min(1).max(128),
  templateId: z.string().min(1).max(64),
  url: z.string().max(512).optional(),
  data: z.record(z.string(), TemplateValueSchema),
});

/**
 * GET /api/admin/wechat/broadcasts
 *
 * The announcements, newest first.
 */
export async function GET() {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const broadcasts = await listBroadcasts();
    return NextResponse.json({ ok: true, data: { broadcasts } });
  });
}

/**
 * POST /api/admin/wechat/broadcasts
 *
 * Creates an announcement and puts it in the queue.
 *
 * ⚠️ Creating it does NOT send it. The scheduler sends the queue, one
 * announcement per tick — an announcement that went out the moment it
 * was written would have no chance to be cancelled.
 */
export async function POST(req: NextRequest) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    // ⚠️ The switch has to be honored here, not only on the screen: an
    // admin who turns the feature off expects no announcement to go out.
    const config = await getWechatConfig();
    if (!isWechatConfigured(config)) {
      return badRequest('not_configured', 'the WeChat announcement is not enabled or not configured yet');
    }
    const parsed = BroadcastSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return badRequest('validation', parsed.error.message);
    let data;
    try {
      data = validateTemplateData(parsed.data.data);
    } catch (error) {
      return badRequest('validation', error instanceof Error ? error.message : String(error));
    }
    // ⚠️ The jump url goes into a message from the official account, and
    // the follower taps it. It must point at THIS site — a url to another
    // host would be a phishing link inside our own message. A relative
    // path is resolved against the site url, because WeChat wants an
    // absolute one and would reject a relative one as a parameter error
    // — which stops the whole broadcast.
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
    const id = await createBroadcast({
      title: parsed.data.title,
      templateId: parsed.data.templateId,
      url,
      data,
      createdBy: auth.user.id,
    });
    await queueBroadcast(id);
    await writeAudit({
      userId: auth.user.id,
      event: 'wechat_broadcast_created',
      metadata: { id, title: parsed.data.title },
    });
    return NextResponse.json({ ok: true, data: { id } });
  });
}
