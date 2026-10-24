import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import { getConfig, setConfig } from '@/lib/config';
import { writeAudit } from '@/lib/audit';

/**
 * The AI mock mode switch.
 *
 * `ai.mock_mode` is the config key lib/llm.ts and lib/ai-rare-chars.ts read to
 * short-circuit every LLM call with a placeholder answer. The admin page
 * toggles it from here.
 */
const MOCK_MODE_KEY = 'ai.mock_mode';

export async function GET(_req: NextRequest) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const enabled = (await getConfig(MOCK_MODE_KEY)) === 'true';
    return NextResponse.json({ ok: true, data: { enabled } });
  });
}

export async function POST(req: NextRequest) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const body = await req.json().catch(() => null);
    if (!body || typeof body.enabled !== 'boolean') {
      return badRequest('validation', 'enabled must be a boolean');
    }
    const enabled = body.enabled;
    try {
      await setConfig(MOCK_MODE_KEY, enabled ? 'true' : 'false', auth.user.id);
    } catch (err) {
      return badRequest('validation', (err as Error).message);
    }
    await writeAudit({
      userId: auth.user.id,
      event: 'ai_config_updated',
      metadata: { keys: [MOCK_MODE_KEY], enabled },
    });
    return NextResponse.json({ ok: true, data: { enabled } });
  });
}
