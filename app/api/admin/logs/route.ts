import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import { listUnifiedLogs } from '@/lib/admin-logs';

export async function GET(req: NextRequest) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const sp = req.nextUrl.searchParams;
    const after = sp.get('after');
    if (after && isNaN(Date.parse(after))) return badRequest('bad_after', 'after must be ISO timestamp');
    const result = await listUnifiedLogs({
      type: sp.get('type') ?? undefined,
      userId: sp.get('userId') ? parseInt(sp.get('userId')!, 10) : undefined,
      ip: sp.get('ip') ?? undefined,
      from: sp.get('from') ?? undefined,
      to: sp.get('to') ?? undefined,
      page: sp.get('page') ? parseInt(sp.get('page')!, 10) : undefined,
      pageSize: sp.get('pageSize') ? parseInt(sp.get('pageSize')!, 10) : undefined,
    });
    return NextResponse.json({ ok: true, data: result });
  });
}