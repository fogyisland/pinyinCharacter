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
    const pid = parseInt(id, 10);
    if (!Number.isInteger(pid) || pid <= 0) return badRequest('bad_id', 'invalid id');
    // No DB existence check — poems are public.
    // Use a SELECT 1 to confirm the id exists so a typo doesn't silently log a fake print.
    const [rows] = await getPool().query<any[]>(`SELECT 1 FROM poems WHERE id = ? LIMIT 1`, [pid]);
    if (rows.length === 0) return notFound('not_found', 'poem not found');
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
    const ua = req.headers.get('user-agent') ?? null;
    await logDownload({
      userId: auth.user.id, format: 'print', sourceType: 'poem', sourceId: String(pid),
      ip,
    });
    await writeAudit({ userId: auth.user.id, event: 'poem_saved', metadata: { action: 'print', poemId: pid }, ip, userAgent: ua });
    return NextResponse.json({ ok: true, data: { id: pid } });
  });
}
