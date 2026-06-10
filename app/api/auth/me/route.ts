import { NextResponse } from 'next/server';
import { getCurrentUserWithAdmin } from '@/lib/auth';

export async function GET() {
  const user = await getCurrentUserWithAdmin();
  if (!user) {
    return NextResponse.json({ ok: false, error: { code: 'unauthenticated', message: '未登录' } }, { status: 401 });
  }
  return NextResponse.json({ ok: true, data: { user } });
}
