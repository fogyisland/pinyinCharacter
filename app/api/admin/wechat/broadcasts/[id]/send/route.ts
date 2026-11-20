import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling, badRequest, conflict } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import { writeAudit } from '@/lib/audit';
import { getBroadcast } from '@/lib/wechat-broadcasts';
import { sendBroadcast } from '@/lib/wechat-sender';
import { getWechatConfig, isWechatConfigured } from '@/lib/wechat-config';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/wechat/broadcasts/[id]/send
 *
 * Sends the announcement now, instead of waiting for the scheduler tick.
 *
 * ⚠️ The counts are "accepted", not "delivered" — WeChat issues no
 * delivery receipt for a template message, so a zero errcode means the
 * request was accepted and nothing more.
 */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    // ⚠️ The switch stops the sending too, not just the writing.
    const config = await getWechatConfig();
    if (!isWechatConfigured(config)) {
      return badRequest('not_configured', 'the WeChat announcement is not enabled or not configured yet');
    }
    const { id } = await ctx.params;
    const numericId = Number(id);
    if (!Number.isInteger(numericId) || numericId <= 0) {
      return badRequest('validation', 'the id must be a positive integer');
    }
    const broadcast = await getBroadcast(numericId);
    if (!broadcast) return badRequest('not_found', 'the announcement does not exist');
    // ⚠️ Only a queued announcement may be sent. Sending one that
    // already went out would deliver it to every follower a second time
    // and burn the daily quota — the scarce resource this whole feature
    // is rationed against. `failed` may be re-sent on purpose (a retry),
    // and `sending` means another run already has it.
    if (broadcast.status !== 'queued' && broadcast.status !== 'failed') {
      return conflict('bad_state', `this announcement is ${broadcast.status}`);
    }
    const result = await sendBroadcast(numericId);
    await writeAudit({
      userId: auth.user.id,
      event: 'wechat_broadcast_sent',
      metadata: {
        id: numericId,
        title: broadcast.title,
        status: result.status,
        accepted: result.accepted,
        skipped: result.skipped,
        failed: result.failed,
      },
    });
    return NextResponse.json({ ok: true, data: result });
  });
}
