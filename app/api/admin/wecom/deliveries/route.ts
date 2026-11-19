import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import { getPool } from '@/lib/db';
import { isMissingTableError } from '@/lib/db-error';

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
    let rows: DeliveryRow[];
    try {
      const [result] = await getPool().query<DeliveryRow[]>(
        `SELECT d.id, d.webhook_id, w.name, d.category, d.subject, d.status,
                d.attempts, d.last_error, d.next_attempt_at, d.sent_at, d.created_at
         FROM wecom_deliveries d
         LEFT JOIN wecom_webhooks w ON w.id = d.webhook_id
         ORDER BY d.created_at DESC
         LIMIT ?`,
        [limit],
      );
      rows = result;
    } catch (error) {
      // A missing table means the migration has not been run yet. Say so,
      // instead of the generic "server error" the admin cannot act on.
      if (isMissingTableError(error)) {
        return badRequest(
          'migration_missing',
          'The WeCom tables are not there yet — run the migration on the server.',
        );
      }
      throw error;
    }
    return NextResponse.json({ ok: true, data: { deliveries: rows } });
  });
}
