import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import { getSchedulerRunHistory } from '@/lib/scheduler-config';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const limitRaw = req.nextUrl.searchParams.get('limit');
    const limit = limitRaw ? Math.max(1, Math.min(parseInt(limitRaw, 10) || 20, 200)) : 20;
    const runs = await getSchedulerRunHistory(limit);
    return NextResponse.json({ ok: true, data: { runs, limit } });
  });
}