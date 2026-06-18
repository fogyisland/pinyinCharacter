import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import { getAllConfig, setConfigBatch } from '@/lib/config';
import { writeAudit } from '@/lib/audit';

const SmtpConfigSchema = z.object({
  'smtp.transport': z.enum(['console', 'smtp']).optional(),
  'smtp.host': z.string().max(256).optional(),
  'smtp.port': z.string().regex(/^\d+$/).optional(),
  'smtp.secure': z.enum(['true', 'false']).optional(),
  'smtp.user': z.string().max(256).optional(),
  'smtp.pass': z.string().max(256).optional(),
  'smtp.from': z.string().max(256).optional(),
  'smtp.from_name': z.string().max(128).optional(),
});

const SECRET_KEYS: ReadonlySet<string> = new Set(['smtp.pass']);

export async function POST(req: NextRequest) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const parsed = SmtpConfigSchema.safeParse(await req.json());
    if (!parsed.success) return badRequest('validation', parsed.error.message);
    const updates: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed.data)) {
      if (v !== undefined && v !== '') updates[k] = v;
    }
    if (Object.keys(updates).length === 0) return badRequest('empty', 'no fields to update');
    try {
      await setConfigBatch(updates, auth.user.id);
    } catch (err) {
      return badRequest('validation', (err as Error).message);
    }
    await writeAudit({
      userId: auth.user.id,
      event: 'smtp_config_updated',
      metadata: { keys: Object.keys(updates) },
    });
    const all = await getAllConfig();
    const config: Record<string, string | null> = {
      'smtp.transport': all['smtp.transport'] ?? 'console',
      'smtp.host': all['smtp.host'] ?? '',
      'smtp.port': all['smtp.port'] ?? '',
      'smtp.secure': all['smtp.secure'] ?? '',
      'smtp.user': all['smtp.user'] ?? '',
      'smtp.from': all['smtp.from'] ?? '',
      'smtp.from_name': all['smtp.from_name'] ?? '',
    };
    // Don't echo the password back.
    const passSet = !!all['smtp.pass'];
    return NextResponse.json({ ok: true, data: { config, passSet } });
  });
}
