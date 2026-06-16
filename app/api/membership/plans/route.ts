import { NextResponse } from 'next/server';
import { withErrorHandling } from '@/lib/api-handler';
import { listPlans } from '@/lib/membership';

export async function GET() {
  return withErrorHandling(async () => {
    const items = await listPlans({ enabledOnly: true });
    return NextResponse.json({ ok: true, data: { items } });
  });
}
