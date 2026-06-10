import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { listUsers } from '@/lib/admin';

export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const sp = req.nextUrl.searchParams;
  const limit = sp.get('limit') ? Number(sp.get('limit')) : 50;
  const offset = sp.get('offset') ? Number(sp.get('offset')) : 0;
  const result = await listUsers({ limit, offset });
  return NextResponse.json({ ok: true, data: result });
}
