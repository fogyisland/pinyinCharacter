import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import { listDownloads } from '@/lib/admin-downloads';

export async function GET(req: NextRequest) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const sp = req.nextUrl.searchParams;
    const result = await listDownloads({
      userId: sp.get('userId') ? parseInt(sp.get('userId')!, 10) : undefined,
      sourceType: (sp.get('sourceType') as any) ?? undefined,
      from: sp.get('from') ?? undefined,
      to: sp.get('to') ?? undefined,
      page: sp.get('page') ? parseInt(sp.get('page')!, 10) : undefined,
      pageSize: sp.get('pageSize') ? parseInt(sp.get('pageSize')!, 10) : undefined,
    });
    return NextResponse.json({ ok: true, data: result });
  });
}