import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUserWithAdmin } from '@/lib/auth';
import { createCampaign, listCampaigns } from '@/lib/email-campaigns';
import { writeAudit } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const createSchema = z.object({
  subject: z.string().min(1).max(255),
  htmlBody: z.string().min(1).max(200_000),
  textBody: z.string().min(1).max(200_000),
  audience: z.enum(['all', 'members', 'admins']),
});

export async function GET() {
  const user = await getCurrentUserWithAdmin();
  if (!user?.isAdmin) {
    return NextResponse.json({ ok: false, error: { code: 'forbidden', message: 'admin only' } }, { status: 403 });
  }
  const rows = await listCampaigns();
  return NextResponse.json({ ok: true, data: rows });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUserWithAdmin();
  if (!user?.isAdmin) {
    return NextResponse.json({ ok: false, error: { code: 'forbidden', message: 'admin only' } }, { status: 403 });
  }
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: { code: 'bad_json' } }, { status: 400 }); }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: { code: 'bad_input', message: parsed.error.issues[0]?.message } }, { status: 400 });
  }
  const id = await createCampaign({ ...parsed.data, createdBy: user.id });
  await writeAudit({ userId: user.id, event: 'campaign_created', metadata: { campaign_id: id, audience: parsed.data.audience, subject: parsed.data.subject } });
  return NextResponse.json({ ok: true, data: { id } });
}