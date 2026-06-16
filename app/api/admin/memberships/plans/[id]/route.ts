import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling, badRequest, notFound } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import { updatePlan, type PlanPatch } from '@/lib/membership';

const PatchSchema = z.object({
  displayName: z.string().min(1).max(64).optional(),
  durationDays: z.number().int().min(1).max(3650).optional(),
  amount: z.string().regex(/^\d+\.\d{2}$/).optional(),
  enabled: z.boolean().optional(),
  displayOrder: z.number().int().min(0).max(999).optional(),
  features: z.array(z.enum(['unlimited_history', 'download_pdf', 'ai_calls', 'priority_tts'])).optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const { id: idStr } = await params;
    const id = Number(idStr);
    if (!Number.isInteger(id) || id <= 0) return badRequest('bad_id', 'invalid plan id');

    const parsed = PatchSchema.safeParse(await req.json());
    if (!parsed.success) return badRequest('validation', parsed.error.message);

    try {
      const plan = await updatePlan(id, parsed.data as PlanPatch);
      return NextResponse.json({ ok: true, data: { plan } });
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.startsWith('plan_not_found')) return notFound('plan_not_found', msg);
      throw err;
    }
  });
}
