import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling, notFound } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import { writeAudit } from '@/lib/audit';
import { softDeleteNote } from '@/lib/notes';

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const { id: rawId } = await ctx.params;
    const id = parseInt(rawId, 10);
    if (!Number.isInteger(id) || id <= 0) return notFound('not_found', 'note not found');
    const ok = await softDeleteNote(id, auth.user.id);
    if (!ok) return notFound('not_found', 'note not found or already deleted');
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
    const ua = req.headers.get('user-agent') ?? null;
    await writeAudit({
      userId: auth.user.id,
      event: 'notes_deleted',
      metadata: { id },
      ip, userAgent: ua,
    });
    return NextResponse.json({ ok: true, data: { id } });
  });
}