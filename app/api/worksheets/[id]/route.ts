import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getWorksheet, deleteWorksheet, renameWorksheet } from '@/lib/worksheet';
import { withErrorHandling, notFound, forbidden, unauthorized, badRequest, conflict } from '@/lib/api-handler';
import { renameWorksheetSchema } from '@/lib/validators';
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

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withErrorHandling(async () => {
    const user = await getCurrentUser();
    if (!user) return unauthorized();
    const { id } = await params;
    const wid = Number(id);
    if (!Number.isInteger(wid) || wid < 1) return badRequest('bad_id', 'bad id');

    const body = await req.json();
    const parsed = renameWorksheetSchema.safeParse(body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return badRequest('bad_input', issue?.message ?? 'bad input');
    }

    const result = await renameWorksheet(wid, user.id, parsed.data.title);
    if (!result.ok) {
      if (result.code === 'not_found') return notFound();
      if (result.code === 'not_owner') return forbidden();
      return conflict('duplicate_title', 'title already in use');
    }
    await logUserAction(req, user.id, 'worksheet_saved', {
      action: 'rename',
      worksheetId: wid,
      title: result.title,
    });
    return NextResponse.json({ ok: true, data: { title: result.title } });
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