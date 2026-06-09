import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getStats } from '@/lib/history';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: { code: 'unauthenticated', message: '未登录' } }, { status: 401 });
  const stats = await getStats(user.id);
  return NextResponse.json({ ok: true, data: stats });
}
