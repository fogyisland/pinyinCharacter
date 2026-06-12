import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import { getAllConfig, setConfigBatch } from '@/lib/config';
import { writeAudit } from '@/lib/audit';

const CONFIG_KEYS = ['ai.model', 'ai.rate_limit_per_user_per_day', 'ai.timeout_ms', 'ai.temperature'] as const;
type AiConfigKey = typeof CONFIG_KEYS[number];

export async function GET(_req: NextRequest) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const all = await getAllConfig();
    const out: Record<string, string> = {};
    for (const k of CONFIG_KEYS) out[k] = all[k] ?? '';
    return NextResponse.json({ ok: true, data: out });
  });
}

export async function PUT(req: NextRequest) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const body = await req.json();
    const updates: Record<string, string> = {};
    for (const k of CONFIG_KEYS) {
      if (k in body && body[k] !== undefined) updates[k] = String(body[k]);
    }
    if (Object.keys(updates).length === 0) return badRequest('empty', 'no fields to update');
    try {
      await setConfigBatch(updates, auth.user.id);
    } catch (err) {
      return badRequest('validation', (err as Error).message);
    }
    await writeAudit({ userId: auth.user.id, event: 'ai_config_updated', metadata: updates });
    return NextResponse.json({ ok: true, data: updates });
  });
}
