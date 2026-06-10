import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { getSystemStats } from '@/lib/admin';

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const stats = await getSystemStats();
  return NextResponse.json({ ok: true, data: stats });
}
