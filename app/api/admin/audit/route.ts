import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { getAuditLog } from '@/lib/admin';
import type { AuditLogOptions } from '@/lib/admin';
import type { AuditEvent } from '@/lib/audit';

export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const sp = req.nextUrl.searchParams;
  const opts: AuditLogOptions = {};
  const userIdStr = sp.get('userId');
  const event = sp.get('event');
  const from = sp.get('from');
  const to = sp.get('to');
  const limitStr = sp.get('limit');
  const offsetStr = sp.get('offset');
  if (userIdStr) {
    const n = Number(userIdStr);
    if (Number.isInteger(n) && n > 0) opts.userId = n;
  }
  if (event) opts.event = event as AuditEvent;
  if (from) opts.from = from;
  if (to) opts.to = to;
  if (limitStr) opts.limit = Number(limitStr);
  if (offsetStr) opts.offset = Number(offsetStr);

  const result = await getAuditLog(opts);
  return NextResponse.json({ ok: true, data: result });
}
