import { NextRequest, NextResponse } from 'next/server';
import { getAllConfig, setConfigBatch } from '@/lib/config';
import { withErrorHandling, unauthorized, forbidden } from '@/lib/api-handler';
import { getCurrentUserWithAdmin } from '@/lib/auth';

export const dynamic = 'force-dynamic';

async function requireAdminUser() {
  const u = await getCurrentUserWithAdmin();
  if (!u) return unauthorized();
  if (!u.isAdmin) return forbidden();
  return u;
}

export async function GET() {
  return withErrorHandling(async () => {
    const r = await requireAdminUser();
    if (r instanceof NextResponse) return r;
    const all = await getAllConfig();
    // 只返 tts.* (admin/ai 走自己端点)
    const tts: Record<string, string> = {};
    for (const [k, v] of Object.entries(all)) {
      if (k.startsWith('tts.')) tts[k] = v;
    }
    return NextResponse.json({ ok: true, data: tts });
  });
}

export async function PUT(req: NextRequest) {
  return withErrorHandling(async () => {
    const r = await requireAdminUser();
    if (r instanceof NextResponse) return r;
    const body = await req.json();
    if (typeof body !== 'object' || body === null) {
      return NextResponse.json({ ok: false, error: { code: 'bad_input', message: 'body must be object' } }, { status: 400 });
    }
    const updates: Record<string, string> = {};
    for (const [k, v] of Object.entries(body)) {
      if (typeof v !== 'string') continue;
      if (k.startsWith('tts.')) updates[k] = v;
    }
    await setConfigBatch(updates, r.id);
    return NextResponse.json({ ok: true, data: updates });
  });
}
