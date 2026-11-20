import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import { writeAudit } from '@/lib/audit';
import { getBroadcast } from '@/lib/wechat-broadcasts';
import { sendBroadcast } from '@/lib/wechat-sender';

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
    const { id } = await ctx.params;
    const numericId = Number(id);
    if (!Number.isInteger(numericId) || numericId <= 0) {
      return badRequest('validation', 'the id must be a positive integer');
    }
    const broadcast = await getBroadcast(numericId);
    if (!broadcast) return badRequest('not_found', 'the announcement does not exist');
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
