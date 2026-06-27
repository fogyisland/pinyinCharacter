import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserWithAdmin } from '@/lib/auth';
import { getCampaign, resolveAudience, armCampaign } from '@/lib/email-campaigns';
import { writeAudit } from '@/lib/audit';
import { runEmailCampaignSend } from '@/lib/scheduler-tasks';

export const runtime = 'nodejs';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUserWithAdmin();
  if (!user?.isAdmin) {
    return NextResponse.json({ ok: false, error: { code: 'forbidden', message: 'admin only' } }, { status: 403 });
  }
  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ ok: false, error: { code: 'bad_id' } }, { status: 400 });
  }
  const c = await getCampaign(id);
  if (!c) {
    return NextResponse.json({ ok: false, error: { code: 'not_found' } }, { status: 404 });
  }
  if (c.status !== 'draft' && c.status !== 'failed') {
    return NextResponse.json({ ok: false, error: { code: 'bad_state', message: `campaign is ${c.status}` } }, { status: 409 });
  }
  const audience = await resolveAudience(c.audience);
  if (audience.length === 0) {
    return NextResponse.json({ ok: false, error: { code: 'empty_audience', message: '没有匹配的收件人 (可能都已退订或筛选条件过严)' } }, { status: 400 });
  }
  const queued = await armCampaign(id, audience);
  await writeAudit({ userId: user.id, event: 'campaign_armed', metadata: { campaign_id: id, queued, audience: c.audience } });

  // Kick the scheduler task in-process. The tick interval (default 60 min)
  // is too slow for a freshly-armed campaign — fire one immediate pass so
  // the first 50 emails go out without waiting. Subsequent batches resume
  // on the next tick. Failures here are non-fatal: the scheduler will retry.
  runEmailCampaignSend().catch((e) => console.warn('[campaign] immediate send failed:', (e as Error).message));

  return NextResponse.json({ ok: true, data: { queued } });
}