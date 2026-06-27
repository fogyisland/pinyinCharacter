import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import {
  hashPassword, signSession, setSessionCookie,
} from '@/lib/auth';
import { writeAudit } from '@/lib/audit';
import { registerSchema } from '@/lib/validators';
import { sendEmail } from '@/lib/email';
import { welcomeEmail, emailVerificationEmail } from '@/lib/email-templates';
import { issueVerificationToken } from '@/lib/email-verification';
import { getRuntimeSiteUrl } from '@/lib/seo/config';

export async function POST(req: NextRequest) {
  let body: unknown;
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: { code: 'bad_json', message: '请求体不是合法 JSON' } }, { status: 400 }); }

  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json({ ok: false, error: { code: 'bad_input', message: issue?.message ?? 'invalid input' } }, { status: 400 });
  }
  const { username, email, password } = parsed.data;

  const pool = getPool();
  const [rows] = await pool.execute<any[]>(`SELECT COUNT(*) AS n FROM users`);
  const isFirst = Number(rows[0]?.n ?? 0) === 0;

  const hash = await hashPassword(password);
  let userId: number;
  try {
    const [res] = await pool.execute<any>(
      `INSERT INTO users (username, email, password_hash, is_admin) VALUES (?, ?, ?, ?)`,
      [username, email, hash, isFirst ? 1 : 0]
    );
    userId = Number(res.insertId);
  } catch (e: any) {
    if (e?.code === 'ER_DUP_ENTRY') {
      if (e?.message?.includes('uk_email') || e?.sqlMessage?.includes('uk_email')) {
        return NextResponse.json({ ok: false, error: { code: 'email_taken', message: '邮箱已被注册' } }, { status: 409 });
      }
      return NextResponse.json({ ok: false, error: { code: 'username_taken', message: '用户名已被占用' } }, { status: 409 });
    }
    throw e;
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
  const ua = req.headers.get('user-agent') ?? null;
  await writeAudit({ userId, event: 'register', metadata: { isFirst, email }, ip, userAgent: ua });

  // Send a welcome email — failures here MUST NOT block registration.
  // The user already has a session cookie + the audit row; if SMTP is
  // misconfigured we want them in, with email_send_history recording the
  // failure for the admin to spot from /admin/email.
  try {
    const siteUrl = await getRuntimeSiteUrl();
    const tpl = welcomeEmail({ username, loginUrl: `${siteUrl}/login` });
    await sendEmail({ to: email, subject: tpl.subject, html: tpl.html, text: tpl.text, template: 'welcome' });
    await writeAudit({ userId, event: 'welcome_email_sent', metadata: { to: email }, ip, userAgent: ua });
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    await writeAudit({ userId, event: 'welcome_email_failed', metadata: { to: email, error: err }, ip, userAgent: ua });
  }

  // Issue email verification token + send a verification email (soft — UI
  // just shows "未验证" if ignored; site is fully usable either way).
  try {
    const { rawToken } = await issueVerificationToken(userId);
    const siteUrl = await getRuntimeSiteUrl();
    const tpl = emailVerificationEmail({
      username,
      verifyUrl: `${siteUrl}/api/auth/verify-email?token=${encodeURIComponent(rawToken)}`,
      expiresInHours: 24,
    });
    await sendEmail({ to: email, subject: tpl.subject, html: tpl.html, text: tpl.text, template: 'email_verification' });
    await writeAudit({ userId, event: 'verification_email_sent', metadata: { to: email }, ip, userAgent: ua });
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    await writeAudit({ userId, event: 'verification_email_failed', metadata: { to: email, error: err }, ip, userAgent: ua });
  }

  const user = { id: userId, username, isAdmin: isFirst };
  const token = await signSession(user);
  await setSessionCookie(token, { secure: process.env.COOKIE_SECURE === 'true' });
  return NextResponse.json({ ok: true, data: { user } });
}
