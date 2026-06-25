import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { clearLock, getActivationStatus } from '@/lib/activation';
import { writeAudit } from '@/lib/audit';

const unlockSchema = z.object({
  code: z.string().min(4).max(128),
});

/**
 * POST /api/activation/unlock — submit an activation code to clear the
 * platform lock. Validates against BOOMING_ACTIVATION_CODES env var
 * (comma-separated list of valid codes). On match, sets lock=0 in DB and
 * audits the unlock event. On miss, returns 401.
 *
 * Public (no auth) — locked-out users must be able to call this.
 */
export async function POST(req: NextRequest) {
  return withErrorHandling(async () => {
    const body = await req.json();
    const parsed = unlockSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest('invalid_input', 'Activation code is required (4-128 chars).');
    }
    const envCodes = (process.env.BOOMING_ACTIVATION_CODES ?? '').split(',').map(s => s.trim()).filter(Boolean);
    if (envCodes.length === 0) {
      return badRequest('not_configured', 'Server has no activation codes configured. Set BOOMING_ACTIVATION_CODES env var.');
    }
    if (!envCodes.includes(parsed.data.code)) {
      // Audit the failed attempt — useful for spotting brute-force or
      // misconfigured clients in /admin/logs.
      try {
        await writeAudit({
          userId: null,
          event: 'activation_unlock',
          metadata: { source: 'code_mismatch' },
          ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
          userAgent: req.headers.get('user-agent') ?? null,
        });
      } catch { /* ignore */ }
      return badRequest('invalid_code', 'Activation code is not valid.');
    }
    const before = await getActivationStatus();
    await clearLock();
    try {
      await writeAudit({
        userId: null,
        event: 'activation_unlock',
        metadata: {
          source: 'code',
          shortName: before?.shortName ?? null,
        },
        ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
        userAgent: req.headers.get('user-agent') ?? null,
      });
    } catch { /* ignore */ }
    return NextResponse.json({ ok: true, data: { unlocked: true } });
  });
}
