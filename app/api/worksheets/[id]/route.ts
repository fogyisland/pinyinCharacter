import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getWorksheet, deleteWorksheet } from '@/lib/worksheet';
import { withErrorHandling, notFound, forbidden, unauthorized, badRequest } from '@/lib/api-handler';
import { logUserAction } from '@/lib/audit';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withErrorHandling(async () => {
    const user = await getCurrentUser();
    if (!user) return unauthorized();
    const { id } = await params;
    const wid = Number(id);
    if (!Number.isInteger(wid) || wid < 1) return badRequest('bad_id', 'bad id');
    const ws = await getWorksheet(wid);
    if (!ws) return notFound();
    if (ws.userId !== user.id) return forbidden();
    return NextResponse.json({ ok: true, data: ws });
  });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withErrorHandling(async () => {
    const user = await getCurrentUser();
    if (!user) return unauthorized();
    const { id } = await params;
    const wid = Number(id);
    if (!Number.isInteger(wid) || wid < 1) return badRequest('bad_id', 'bad id');
    const ws = await getWorksheet(wid);
    if (!ws) return notFound();
    if (ws.userId !== user.id) return forbidden();
    await deleteWorksheet(wid, user.id);
    await logUserAction(req, user.id, 'worksheet_deleted', {
      worksheetId: wid,
      title: ws.title,
    });
    return new NextResponse(null, { status: 204 });
  });
}
