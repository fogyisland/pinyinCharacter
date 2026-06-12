import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { listUsers } from '@/lib/admin';

export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const sp = req.nextUrl.searchParams;
  const limit = sp.get('limit') ? Number(sp.get('limit')) : 50;
  const offset = sp.get('offset') ? Number(sp.get('offset')) : 0;
  const q = sp.get('q') ?? undefined;
  const isAdminRaw = sp.get('isAdmin');
  const isAdmin = isAdminRaw === null ? undefined : isAdminRaw === 'true';
  const disabledRaw = sp.get('disabled');
  const disabled = disabledRaw === null ? undefined : disabledRaw === 'true';
  const result = await listUsers({ limit, offset, q, isAdmin, disabled });
  return NextResponse.json({ ok: true, data: result });
}
