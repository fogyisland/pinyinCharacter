import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling, notFound } from '@/lib/api-handler';
import { requireUser } from '@/lib/auth';
import { getPool } from '@/lib/db';
import { hasFeature } from '@/lib/membership';
import { exceedsFreeLimit } from '@/lib/worksheet-page-count';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withErrorHandling(async () => {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;
    const { id } = await params;
    const wid = parseInt(id, 10);
    if (!Number.isInteger(wid) || wid <= 0) {
      return NextResponse.json({ ok: true, data: { canPrint: true } });
    }
    const [rows] = await getPool().query<any[]>(
      `SELECT content, paper_size FROM worksheets WHERE id = ? AND user_id = ? LIMIT 1`,
      [wid, auth.user.id]
    );
    if (rows.length === 0) return notFound('not_found', 'worksheet not found');
    const ws = rows[0];
    const isMember = await hasFeature(auth.user.id, 'multi_worksheet_print');
    if (isMember) {
      return NextResponse.json({ ok: true, data: { canPrint: true } });
    }
    if (exceedsFreeLimit(ws.content.length, ws.paper_size)) {
      return NextResponse.json({
        ok: true,
        data: { canPrint: false, reason: 'multi_page', upgradeUrl: '/membership' },
      });
    }
    return NextResponse.json({ ok: true, data: { canPrint: true } });
  });
}