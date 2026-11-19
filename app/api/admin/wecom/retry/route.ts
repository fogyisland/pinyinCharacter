import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import type { ResultSetHeader } from 'mysql2';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import { writeAudit } from '@/lib/audit';
import { getPool } from '@/lib/db';
import { isMissingTableError } from '@/lib/db-error';

export const dynamic = 'force-dynamic';

const RetrySchema = z.object({ id: z.number().int().positive() });

export async function POST(req: NextRequest) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const parsed = RetrySchema.safeParse(await req.json());
    if (!parsed.success) return badRequest('validation', parsed.error.message);
    let result: ResultSetHeader;
    try {
      const [outcome] = await getPool().query<ResultSetHeader>(
        `UPDATE wecom_deliveries
         SET status = 'pending', attempts = 0, last_error = NULL,
             next_attempt_at = CURRENT_TIMESTAMP(3)
         WHERE id = ?`,
        [parsed.data.id],
      );
      result = outcome;
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
    if (result.affectedRows === 0) {
      return badRequest('not_found', 'delivery not found');
    }
    await writeAudit({
      userId: auth.user.id,
      event: 'wecom_delivery_retried',
      metadata: { id: parsed.data.id },
    });
    return NextResponse.json({ ok: true, data: { id: parsed.data.id } });
  });
}
