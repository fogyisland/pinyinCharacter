import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';
import { withErrorHandling } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import { getPool } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** One row of the delivery history, joined with the group it went to. */
interface DeliveryRow extends RowDataPacket {
  id: number;
  webhook_id: number;
  name: string | null;
  category: string;
  subject: string;
  status: string;
  attempts: number;
  last_error: string | null;
  next_attempt_at: Date;
  sent_at: Date | null;
  created_at: Date;
}

export async function GET(req: NextRequest) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const limit = Math.min(
      Math.max(parseInt(new URL(req.url).searchParams.get('limit') ?? '50', 10) || 50, 1),
      200,
    );
    const [rows] = await getPool().query<DeliveryRow[]>(
      `SELECT d.id, d.webhook_id, w.name, d.category, d.subject, d.status,
              d.attempts, d.last_error, d.next_attempt_at, d.sent_at, d.created_at
       FROM wecom_deliveries d
       LEFT JOIN wecom_webhooks w ON w.id = d.webhook_id
       ORDER BY d.created_at DESC
       LIMIT ?`,
      [limit],
    );
    return NextResponse.json({ ok: true, data: { deliveries: rows } });
  });
}
