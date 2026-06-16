import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import { listPlans, seedDefaultPlans } from '@/lib/membership';

export async function GET(req: NextRequest) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const enabledOnly = req.nextUrl.searchParams.get('enabledOnly') === '1';
    const items = await listPlans({ enabledOnly });
    return NextResponse.json({ ok: true, data: { items, total: items.length } });
  });
}

export async function POST(_req: NextRequest) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const seeded = await seedDefaultPlans();
    return NextResponse.json({ ok: true, data: { seeded } });
  });
}
