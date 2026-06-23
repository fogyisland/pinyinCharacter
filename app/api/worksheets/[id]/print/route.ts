import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling, badRequest, notFound, forbidden } from '@/lib/api-handler';
import { requireUser } from '@/lib/auth';
import { getPool } from '@/lib/db';
import { hasFeature } from '@/lib/membership';
import { exceedsFreeLimit } from '@/lib/worksheet-page-count';
import { logDownload } from '@/lib/downloads';
import { logUserAction } from '@/lib/audit';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withErrorHandling(async () => {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;
    const { id } = await params;
    const wid = parseInt(id, 10);
    if (!Number.isInteger(wid) || wid <= 0) return badRequest('bad_id', 'invalid id');
    const [rows] = await getPool().query<any[]>(`SELECT id, title, content, paper_size FROM worksheets WHERE id = ? AND user_id = ? LIMIT 1`, [wid, auth.user.id]);
    if (rows.length === 0) return notFound('not_found', 'worksheet not found');
    const isMember = await hasFeature(auth.user.id, 'multi_worksheet_print');
    const ws = rows[0];
    if (!isMember && exceedsFreeLimit(ws.content.length, ws.paper_size)) {
      return forbidden('membership_required', 'multi-page print requires membership');
    }
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
    const userAgent = req.headers.get('user-agent') ?? null;
    await logDownload({
      userId: auth.user.id, format: 'print', sourceType: 'worksheet', sourceId: String(wid),
      ip, userAgent,
    });
    await logUserAction(req, auth.user.id, 'worksheet_saved', {
      action: 'print',
      worksheetId: wid,
      title: rows[0]?.title ?? null,
    });
    return NextResponse.json({ ok: true, data: { id: wid } });
  });
}
