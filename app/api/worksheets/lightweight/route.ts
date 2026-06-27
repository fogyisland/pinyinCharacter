import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { withErrorHandling, unauthorized } from '@/lib/api-handler';
import { listUserWorksheetsLightweight } from '@/lib/worksheet';

export async function GET(_req: NextRequest) {
  return withErrorHandling(async () => {
    const user = await getCurrentUser();
    if (!user) return unauthorized();
    const items = await listUserWorksheetsLightweight(user.id);
    return NextResponse.json({ ok: true, data: { items } });
  });
}