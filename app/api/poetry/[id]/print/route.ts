import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling, badRequest, notFound } from '@/lib/api-handler';
import { requireUser } from '@/lib/auth';
import { getPool } from '@/lib/db';
import { logDownload } from '@/lib/downloads';
import { logUserAction } from '@/lib/audit';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withErrorHandling(async () => {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;
    const { id } = await params;
    const pid = parseInt(id, 10);
    if (!Number.isInteger(pid) || pid <= 0) return badRequest('bad_id', 'invalid id');
    const [rows] = await getPool().query<any[]>(`SELECT id, title FROM poems WHERE id = ? LIMIT 1`, [pid]);
    if (rows.length === 0) return notFound('not_found', 'poem not found');
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
    await logDownload({
      userId: auth.user.id, format: 'print', sourceType: 'poem', sourceId: String(pid),
      ip,
    });
    await logUserAction(req, auth.user.id, 'poem_saved', {
      action: 'print',
      poemId: pid,
      title: rows[0]?.title ?? null,
    });
    return NextResponse.json({ ok: true, data: { id: pid } });
  });
}
