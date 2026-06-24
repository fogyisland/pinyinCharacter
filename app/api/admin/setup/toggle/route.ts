import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import { setSetupRouteEnabled } from '@/lib/setup';
import { writeAudit } from '@/lib/audit';

const toggleSchema = z.object({
  enabled: z.boolean(),
});

/**
 * Admin-only: toggle /init route availability. Writes the flag to app_config
 * and logs to audit_log so the change is traceable.
 */
export async function POST(req: NextRequest) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const body = await req.json();
    const parsed = toggleSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest('invalid_input', parsed.error.issues[0].message);
    }
    await setSetupRouteEnabled(parsed.data.enabled);
    await writeAudit({
      userId: auth.user.id,
      event: parsed.data.enabled ? 'setup_route_enable' : 'setup_route_disable',
      metadata: { route: '/init' },
    });
    return NextResponse.json({ ok: true, data: { enabled: parsed.data.enabled } });
  });
}