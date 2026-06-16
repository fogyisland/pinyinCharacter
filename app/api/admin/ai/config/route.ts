import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import { getAllConfig, setConfigBatch } from '@/lib/config';
import { writeAudit } from '@/lib/audit';

const CONFIG_KEYS = [
  'ai.base_url',
  'ai.model',
  'ai.api_key',
  'ai.rate_limit_per_user_per_day',
  'ai.timeout_ms',
  'ai.temperature',
] as const;
type AiConfigKey = typeof CONFIG_KEYS[number];
const SECRET_KEYS: ReadonlySet<AiConfigKey> = new Set(['ai.api_key']);

export async function GET(_req: NextRequest) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const all = await getAllConfig();
    const config: Record<string, string> = {};
    for (const k of CONFIG_KEYS) {
      config[k] = SECRET_KEYS.has(k) ? '' : (all[k] ?? '');
    }
    const hasApiKey = !!all['ai.api_key'];
    return NextResponse.json({ ok: true, data: { config, hasApiKey } });
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
    await writeAudit({
      userId: auth.user.id,
      event: 'ai_config_updated',
      metadata: Object.fromEntries(Object.entries(updates).map(([k, v]) => [k, SECRET_KEYS.has(k as AiConfigKey) ? '***' : v])),
    });
    const all = await getAllConfig();
    const config: Record<string, string> = {};
    for (const k of CONFIG_KEYS) {
      config[k] = SECRET_KEYS.has(k) ? '' : (all[k] ?? '');
    }
    const hasApiKey = !!all['ai.api_key'];
    return NextResponse.json({ ok: true, data: { config, hasApiKey } });
  });
}
