import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling, badRequest, notFound } from '@/lib/api-handler';
import { requireUser } from '@/lib/auth';
import { getPoem } from '@/lib/poetry';
import { logDownload } from '@/lib/downloads';
import { logUserAction } from '@/lib/audit';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withErrorHandling(async () => {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;
    const { id } = await params;
    const pid = parseInt(id, 10);
    if (!Number.isInteger(pid) || pid <= 0) return badRequest('bad_id', 'invalid id');
    const poem = await getPoem(pid);
    if (!poem) return notFound('not_found', 'poem not found');
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
    await logDownload({
      userId: auth.user.id, format: 'print', sourceType: 'poem', sourceId: String(pid),
      ip,
    });
    await logUserAction(req, auth.user.id, 'poem_saved', {
      action: 'print',
      poemId: pid,
      title: poem.title,
    });
    return NextResponse.json({ ok: true, data: { id: pid } });
  });
}
