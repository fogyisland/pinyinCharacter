import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import { readSchedulerConfig } from '@/lib/scheduler-config';
import { runSchedulerNow } from '@/lib/scheduler';
import { writeAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export async function POST(_req: NextRequest) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const cfg = await readSchedulerConfig();
    const results = await runSchedulerNow(cfg);
    await writeAudit({
      event: 'scheduler_manual_trigger',
      userId: auth.user.id,
      metadata: { taskCount: results.length, okCount: results.filter((r) => r.ok).length },
    });
    return NextResponse.json({ ok: true, data: { results, ranAt: new Date().toISOString() } });
  });
}
