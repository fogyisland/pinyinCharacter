import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling, badRequest, notFound } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import { listMemberships, grantMembership, getPlanByKey, type PlanKey } from '@/lib/membership';
import { writeAudit } from '@/lib/audit';
import { getPool } from '@/lib/db';

export async function GET(req: NextRequest) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const sp = req.nextUrl.searchParams;
    const userId = sp.get('userId') ? Number(sp.get('userId')) : undefined;
    const planKey = sp.get('planKey') ?? undefined;
    const page = sp.get('page') ? Number(sp.get('page')) : undefined;
    const pageSize = sp.get('pageSize') ? Number(sp.get('pageSize')) : undefined;
    const result = await listMemberships({ userId, planKey, page, pageSize });
    return NextResponse.json({ ok: true, data: result });
  });
}

const GrantSchema = z.object({
  userId: z.number().int().positive(),
  planKey: z.string().min(1).max(32),
  note: z.string().max(255).optional(),
});

export async function POST(req: NextRequest) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const body = await req.json();
    const parsed = GrantSchema.safeParse(body);
    if (!parsed.success) return badRequest('validation', parsed.error.message);
    const plan = await getPlanByKey(parsed.data.planKey as PlanKey);
    if (!plan) return notFound('plan_not_found', `plan ${parsed.data.planKey} not found`);
    // Ensure target user exists
    const [u] = await getPool().query<any[]>(`SELECT id FROM users WHERE id = ? LIMIT 1`, [parsed.data.userId]);
    if (u.length === 0) return notFound('user_not_found', `user ${parsed.data.userId} not found`);

    const result = await grantMembership({
      targetUserId: parsed.data.userId,
      planKey: parsed.data.planKey as PlanKey,
      note: parsed.data.note ?? null,
      grantedBy: auth.user.id,
      source: 'manual',
    });
    await writeAudit({
      userId: auth.user.id,
      event: 'membership_granted',
      metadata: {
        targetUserId: parsed.data.userId,
        planKey: parsed.data.planKey,
        currency: plan.currency,
        expiresAt: result.expiresAt.toISOString(),
      },
    });
    return NextResponse.json({ ok: true, data: result });
  });
}
