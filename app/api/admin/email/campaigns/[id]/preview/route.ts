import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserWithAdmin } from '@/lib/auth';
import { getCampaign } from '@/lib/email-campaigns';
import { campaignEmail } from '@/lib/email-templates';
import { sendEmail } from '@/lib/email';
import { writeAudit } from '@/lib/audit';
import { issueUnsubscribeToken } from '@/lib/email-campaigns';

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
  // Resolve the admin's email — fall back to user.username if email missing.
  const adminEmail = (user as any).email as string | undefined;
  if (!adminEmail) {
    return NextResponse.json({ ok: false, error: { code: 'no_email', message: '当前管理员账号没有邮箱' } }, { status: 400 });
  }
  const unsub = issueUnsubscribeToken(user.id);
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:4444').replace(/\/+$/, '');
  const unsubUrl = `${siteUrl}/api/email/unsubscribe?token=${encodeURIComponent(unsub)}`;
  const tpl = campaignEmail({
    username: user.username,
    bodyHtml: c.html_body,
    bodyText: c.text_body,
    unsubscribeUrl: unsubUrl,
  });
  try {
    await sendEmail({ to: adminEmail, subject: `[预览] ${c.subject}`, html: tpl.html, text: tpl.text, template: 'campaign_preview' });
    await writeAudit({ userId: user.id, event: 'campaign_preview_sent', metadata: { campaign_id: id, to: adminEmail } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: { code: 'send_failed', message: err } }, { status: 502 });
  }
}