import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import {
  readSchedulerConfig,
  writeSchedulerConfig,
  type SchedulerConfig,
} from '@/lib/scheduler-config';
import { bootstrapScheduler } from '@/lib/scheduler';
import { adminSchedulerConfigSchema } from '@/lib/validators';
import { writeAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export async function GET() {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const cfg = await readSchedulerConfig();
    return NextResponse.json({ ok: true, data: cfg });
  });
}

export async function POST(req: NextRequest) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const body = await req.json();
    const parsed = adminSchedulerConfigSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest('bad_input', parsed.error.issues[0]?.message ?? 'bad input');
    }
    // ⚠️ The type is `Partial<SchedulerConfig>` on purpose. A narrower
    // `Pick<>` looked right but was inert: `parsed.data` is not a fresh
    // object literal, so assigning it to a narrower type is allowed and
    // nothing is filtered at runtime. The zod schema is what actually
    // decides which fields reach `writeSchedulerConfig`.
    const updates: Partial<SchedulerConfig> = parsed.data;
    await writeSchedulerConfig(updates, auth.user.id);
    // (Re)start the in-process scheduler so live config changes take effect.
    try {
      await bootstrapScheduler();
    } catch (e) {
      console.error('[scheduler] restart after update failed', e);
    }
    await writeAudit({
      event: 'scheduler_config_updated',
      userId: auth.user.id,
      metadata: { keys: Object.keys(updates) },
    });
    const next = await readSchedulerConfig();
    return NextResponse.json({ ok: true, data: next });
  });
}
