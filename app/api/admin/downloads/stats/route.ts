import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import { getDownloadStats } from '@/lib/admin-downloads';

export async function GET(req: NextRequest) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const days = parseInt(req.nextUrl.searchParams.get('days') ?? '7', 10);
    const stats = await getDownloadStats(Math.min(Math.max(days, 1), 90));
    return NextResponse.json({ ok: true, data: stats });
  });
}