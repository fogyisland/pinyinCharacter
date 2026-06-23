import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling, badRequest, notFound } from '@/lib/api-handler';
import { requireUser } from '@/lib/auth';
import { getPool } from '@/lib/db';
import { logDownload } from '@/lib/downloads';
import { logUserAction } from '@/lib/audit';

export async function POST(req: NextRequest, { params }: { params: Promise<{ char: string }> }) {
  return withErrorHandling(async () => {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;
    const { char: raw } = await params;
    const char = decodeURIComponent(raw ?? '');
    if (!char) return badRequest('bad_char', 'invalid char');
    // Verify the char exists in the catalog (don't log fake prints for typos)
    const [rows] = await getPool().query<any[]>(`SELECT 1 FROM rare_chars WHERE \`char\` = ? LIMIT 1`, [char]);
    if (rows.length === 0) return notFound('not_found', 'rare char not found');
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
    const userAgent = req.headers.get('user-agent') ?? null;
    await logDownload({
      userId: auth.user.id, format: 'print', sourceType: 'rare-char-card', sourceId: char,
      ip, userAgent,
    });
    await logUserAction(req, auth.user.id, 'rare_char_card_saved', {
      action: 'print',
      char,
    });
    return NextResponse.json({ ok: true, data: { char } });
  });
}
