import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import { getDownloadStats } from '@/lib/admin-downloads';

export async function GET(req: NextRequest) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const daysRaw = req.nextUrl.searchParams.get('days');
    const daysParsed = daysRaw ? parseInt(daysRaw, 10) : 7;
    const days = Number.isFinite(daysParsed) ? Math.min(Math.max(daysParsed, 1), 90) : 7;
    const stats = await getDownloadStats(days);
    return NextResponse.json({ ok: true, data: stats });
  });
}