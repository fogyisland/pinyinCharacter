import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import { getBroadcast } from '@/lib/wechat-broadcasts';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/wechat/broadcasts/[id]
 *
 * One announcement.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
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
    return NextResponse.json({ ok: true, data: { broadcast } });
  });
}
