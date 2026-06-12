import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import { listAiCalls } from '@/lib/admin-ai';

export async function GET(req: NextRequest) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const sp = req.nextUrl.searchParams;

    const result = await listAiCalls({
      feature: sp.get('feature') ?? undefined,
      status: (sp.get('status') ?? undefined) as any,
      userId: sp.get('userId') ? parseInt(sp.get('userId')!, 10) : undefined,
      from: sp.get('from') ?? undefined,
      to: sp.get('to') ?? undefined,
      page: sp.get('page') ? parseInt(sp.get('page')!, 10) : undefined,
      pageSize: sp.get('pageSize') ? parseInt(sp.get('pageSize')!, 10) : undefined,
    });
    return NextResponse.json({ ok: true, data: result });
  });
}