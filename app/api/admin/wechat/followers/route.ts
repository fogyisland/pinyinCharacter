import { NextResponse } from 'next/server';
import { withErrorHandling } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import { fetchFollowerOpenids } from '@/lib/wechat-api';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/wechat/followers
 *
 * How many followers the account has.
 *
 * ⚠️ The openids themselves are NOT returned. They are the identifiers
 * WeChat uses to address a person, and the admin screen only needs a
 * number to show.
 */
export async function GET() {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const openids = await fetchFollowerOpenids();
    return NextResponse.json({ ok: true, data: { count: openids.length } });
  });
}
