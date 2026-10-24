import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import { getAllConfig, setConfigBatch } from '@/lib/config';
import { writeAudit } from '@/lib/audit';
import { AI_CONFIG_KEYS, AI_SECRET_KEYS, hasAiApiKey, maskAiConfig } from '@/lib/ai-config';

export async function GET(_req: NextRequest) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const all = await getAllConfig();
    return NextResponse.json({
      ok: true,
      data: { config: maskAiConfig(all), hasApiKey: hasAiApiKey(all) },
    });
  });
}

export async function PUT(req: NextRequest) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const body = await req.json();
    const updates: Record<string, string> = {};
    for (const k of AI_CONFIG_KEYS) {
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
      metadata: Object.fromEntries(
        Object.entries(updates).map(([k, v]) => [
          k,
          AI_SECRET_KEYS.has(k as (typeof AI_CONFIG_KEYS)[number]) ? '***' : v,
        ]),
      ),
    });
    const all = await getAllConfig();
    return NextResponse.json({
      ok: true,
      data: { config: maskAiConfig(all), hasApiKey: hasAiApiKey(all) },
    });
  });
}
