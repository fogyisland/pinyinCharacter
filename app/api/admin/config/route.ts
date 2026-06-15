import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import { getAllConfig, setConfigBatch } from '@/lib/config';
import { writeAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export async function GET() {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const all = await getAllConfig();
    const tts: Record<string, string> = {};
    for (const [k, v] of Object.entries(all)) {
      if (k.startsWith('tts.')) tts[k] = v;
    }
    return NextResponse.json({ ok: true, data: tts });
  });
}

export async function PUT(req: NextRequest) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const body = await req.json();
    if (typeof body !== 'object' || body === null) {
      return badRequest('bad_input', 'body must be object');
    }
    const updates: Record<string, string> = {};
    for (const [k, v] of Object.entries(body)) {
      if (typeof v !== 'string') continue;
      if (k.startsWith('tts.')) updates[k] = v;
    }
    if (Object.keys(updates).length === 0) {
      return badRequest('bad_input', 'no tts.* keys in body');
    }
    await setConfigBatch(updates, auth.user.id);
    await writeAudit({
      event: 'tts_config_updated',
      userId: auth.user.id,
      metadata: { keys: Object.keys(updates) },
    });
    return NextResponse.json({ ok: true, data: updates });
  });
}
