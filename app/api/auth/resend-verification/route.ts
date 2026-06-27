import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { issueVerificationToken, findVerificationStatus } from '@/lib/email-verification';
import { sendEmail } from '@/lib/email';
import { emailVerificationEmail } from '@/lib/email-templates';
import { getRuntimeSiteUrl } from '@/lib/seo/config';
import { writeAudit } from '@/lib/audit';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: { code: 'not_authenticated', message: '请先登录' } }, { status: 401 });
  }
  // Refuse if already verified.
  const status = await findVerificationStatus(user.id);
  if (status.verified) {
    return NextResponse.json({ ok: false, error: { code: 'already_verified', message: '邮箱已验证' } }, { status: 400 });
  }
  // Need email — fall back to user.username if email column missing for old rows.
  const email = (user as any).email as string | undefined;
  if (!email) {
    return NextResponse.json({ ok: false, error: { code: 'no_email', message: '账号没有邮箱,无法重发' } }, { status: 400 });
  }
  const { rawToken } = await issueVerificationToken(user.id);
  const siteUrl = await getRuntimeSiteUrl();
  const tpl = emailVerificationEmail({
    username: user.username,
    verifyUrl: `${siteUrl}/api/auth/verify-email?token=${encodeURIComponent(rawToken)}`,
    expiresInHours: 24,
  });
  try {
    await sendEmail({ to: email, subject: tpl.subject, html: tpl.html, text: tpl.text, template: 'email_verification' });
    await writeAudit({ userId: user.id, event: 'verification_resent', metadata: { to: email } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    await writeAudit({ userId: user.id, event: 'verification_resend_failed', metadata: { to: email, error: err } });
    return NextResponse.json({ ok: false, error: { code: 'send_failed', message: '邮件发送失败,请稍后再试' } }, { status: 502 });
  }
}