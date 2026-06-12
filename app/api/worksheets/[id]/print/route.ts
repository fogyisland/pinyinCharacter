import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling, badRequest, notFound } from '@/lib/api-handler';
import { requireUser } from '@/lib/auth';
import { getPool } from '@/lib/db';
import { logDownload } from '@/lib/downloads';
import { writeAudit } from '@/lib/audit';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withErrorHandling(async () => {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;
    const { id } = await params;
    const wid = parseInt(id, 10);
    if (!Number.isInteger(wid) || wid <= 0) return badRequest('bad_id', 'invalid id');
    const [rows] = await getPool().query<any[]>(`SELECT id FROM worksheets WHERE id = ? AND user_id = ? LIMIT 1`, [wid, auth.user.id]);
    if (rows.length === 0) return notFound('not_found', 'worksheet not found');
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
    const ua = req.headers.get('user-agent') ?? null;
    await logDownload({
      userId: auth.user.id, format: 'print', sourceType: 'worksheet', sourceId: String(wid),
      ip,
    });
    await writeAudit({ userId: auth.user.id, event: 'worksheet_saved', metadata: { action: 'print', worksheetId: wid }, ip, userAgent: ua });
    return NextResponse.json({ ok: true, data: { id: wid } });
  });
}
