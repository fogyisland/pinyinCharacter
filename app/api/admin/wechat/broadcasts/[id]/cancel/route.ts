import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import { writeAudit } from '@/lib/audit';
import { cancelBroadcast, getBroadcast } from '@/lib/wechat-broadcasts';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/wechat/broadcasts/[id]/cancel
 *
 * Takes an announcement out of the queue.
 *
 * ⚠️ Only an announcement that has not gone out can be cancelled — the
 * store's WHERE clause decides, and the result says which it was.
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
    const cancelled = await cancelBroadcast(numericId);
    if (!cancelled) {
      return badRequest('not_cancellable', 'this announcement has already been sent');
    }
    await writeAudit({
      userId: auth.user.id,
      event: 'wechat_broadcast_cancelled',
      metadata: { id: numericId, title: broadcast.title },
    });
    return NextResponse.json({ ok: true, data: { id: numericId } });
  });
}
