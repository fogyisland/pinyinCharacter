import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling, badRequest, forbidden, notFound } from '@/lib/api-handler';
import { requireUser } from '@/lib/auth';
import { getPool } from '@/lib/db';
import { hasFeature } from '@/lib/membership';
import { logDownload } from '@/lib/downloads';
import { logUserAction } from '@/lib/audit';
import { printBatchSchema } from '@/lib/validators';
import { pageCountFor, exceedsFreeLimit } from '@/lib/worksheet-page-count';

export async function POST(req: NextRequest) {
  return withErrorHandling(async () => {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;
    const body = await req.json().catch(() => null);
    const parsed = printBatchSchema.safeParse(body);
    if (!parsed.success) return badRequest('bad_input', 'invalid worksheetIds');
    const { worksheetIds } = parsed.data;

    const placeholders = worksheetIds.map(() => '?').join(',');
    const [rows] = await getPool().query<any[]>(
      `SELECT id, title, content, paper_size, cell_style, font_family
       FROM worksheets WHERE user_id = ? AND id IN (${placeholders})`,
      [auth.user.id, ...worksheetIds]
    );
    if (rows.length !== worksheetIds.length) return notFound('not_found', 'worksheet not found');

    const isMember = await hasFeature(auth.user.id, 'multi_worksheet_print');
    if (!isMember) {
      if (worksheetIds.length > 1) {
        return forbidden('membership_required', 'batch print requires membership');
      }
      const ws = rows[0];
      if (exceedsFreeLimit(ws.content.length, ws.paper_size)) {
        return forbidden('membership_required', 'multi-page print requires membership');
      }
    }

    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
    for (const ws of rows) {
      await logDownload({
        userId: auth.user.id, format: 'print', sourceType: 'worksheet', sourceId: String(ws.id), ip,
      });
    }
    await logUserAction(req, auth.user.id, 'worksheet_batch_printed', {
      count: rows.length,
      ids: rows.map((r: any) => r.id),
    });

    return NextResponse.json({
      ok: true,
      data: {
        worksheets: rows.map((r: any) => ({
          id: r.id,
          title: r.title,
          content: r.content,
          paperSize: r.paper_size,
          cellStyle: r.cell_style,
          fontFamily: r.font_family,
        })),
      },
    });
  });
}
