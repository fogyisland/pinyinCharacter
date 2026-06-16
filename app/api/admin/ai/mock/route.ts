import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import { getConfig, setConfig } from '@/lib/config';
import { adminInitMockSchema } from '@/lib/validators';

export const dynamic = 'force-dynamic';

export async function GET() {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const enabled = (await getConfig('ai.mock_mode')) === 'true';
    return NextResponse.json({ ok: true, data: { enabled } });
  });
}

export async function POST(req: NextRequest) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const body = await req.json();
    const parsed = adminInitMockSchema.safeParse(body);
    if (!parsed.success) return badRequest('bad_input', parsed.error.issues[0]?.message ?? 'bad input');
    await setConfig('ai.mock_mode', parsed.data.enabled ? 'true' : 'false', auth.user.id);
    return NextResponse.json({ ok: true, data: { enabled: parsed.data.enabled } });
  });
}
