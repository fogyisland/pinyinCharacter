import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling, unauthorized } from '@/lib/api-handler';
import { getCurrentUser } from '@/lib/auth';
import { getMyActiveMembership } from '@/lib/membership';

export async function GET(_req: NextRequest) {
  return withErrorHandling(async () => {
    const user = await getCurrentUser();
    if (!user) return unauthorized('unauthenticated', 'login required');
    const data = await getMyActiveMembership(user.id);
    return NextResponse.json({ ok: true, data });
  });
}
