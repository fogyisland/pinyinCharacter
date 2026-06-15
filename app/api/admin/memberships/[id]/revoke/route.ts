import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling, badRequest, notFound } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import { revokeMembership } from '@/lib/membership';
import { writeAudit } from '@/lib/audit';

const RevokeSchema = z.object({ reason: z.string().max(255).optional() });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const { id: idStr } = await params;
    const id = Number(idStr);
    if (!Number.isInteger(id) || id <= 0) return badRequest('bad_id', 'invalid membership id');

    const parsed = RevokeSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return badRequest('validation', parsed.error.message);

    try {
      const row = await revokeMembership(id, auth.user.id, parsed.data.reason);
      await writeAudit({
        userId: auth.user.id,
        event: 'membership_revoked',
        metadata: { membershipId: id, targetUserId: row.userId, reason: parsed.data.reason ?? null },
      });
      return NextResponse.json({ ok: true, data: row });
    } catch (err) {
      const msg = (err as Error).message;
      if (msg === 'membership_not_found') return notFound('membership_not_found', msg);
      if (msg === 'already_revoked') {
        return NextResponse.json({ ok: false, error: { code: 'already_revoked', message: msg } }, { status: 409 });
      }
      throw err;
    }
  });
}
