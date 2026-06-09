import { NextResponse } from 'next/server';
import { clearSessionCookie, getCurrentUser } from '@/lib/auth';
import { writeAudit } from '@/lib/audit';

export async function POST() {
  const u = await getCurrentUser();
  if (u) {
    await writeAudit({ userId: u.id, event: 'logout' });
  }
  await clearSessionCookie();
  return new NextResponse(null, { status: 204 });
}
