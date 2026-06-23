import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import { getPool } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const limitRaw = req.nextUrl.searchParams.get('limit');
    const limit = limitRaw ? Math.max(1, Math.min(parseInt(limitRaw, 10) || 50, 200)) : 50;
    const [rows] = await getPool().query<any[]>(
      `SELECT id, to_addr, subject, template, status, error, sent_at
       FROM email_send_history
       ORDER BY sent_at DESC, id DESC
       LIMIT ?`,
      [limit],
    );
    return NextResponse.json({
      ok: true,
      data: {
        items: rows.map(r => ({
          id: Number(r.id),
          to: r.to_addr,
          subject: r.subject,
          template: r.template,
          status: r.status,
          error: r.error,
          sentAt: r.sent_at instanceof Date ? r.sent_at.toISOString() : String(r.sent_at),
        })),
        limit,
      },
    });
  });
}