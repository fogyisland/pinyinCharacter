import { NextRequest, NextResponse } from 'next/server';
import { validateUsername } from '@/lib/auth';
import { findUserByUsername, generateResetToken, createResetRow, RESET_TTL_MINUTES } from '@/lib/password-reset';
import { checkRateLimit } from '@/lib/ratelimit';
import { sendEmail, EmailNotConfiguredError } from '@/lib/email';
import { passwordResetEmail } from '@/lib/email-templates';
import { writeAudit } from '@/lib/audit';

interface Body { username?: string; }

function clientIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  if (!checkRateLimit(ip, 60_000)) {
    return NextResponse.json(
      { ok: false, error: { code: 'rate_limited', message: '请求过于频繁,请稍后再试' } },
      { status: 429 }
    );
  }

  let body: Body;
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: { code: 'bad_json', message: '请求体不是合法 JSON' } }, { status: 400 }); }

  const username = (body.username ?? '').trim();
  const uErr = validateUsername(username);
  if (uErr) return NextResponse.json({ ok: false, error: { code: 'invalid_username', message: uErr } }, { status: 400 });

  const ua = req.headers.get('user-agent') ?? null;
  const user = await findUserByUsername(username);
  if (!user) {
    await writeAudit({ userId: null, event: 'password_reset_request', metadata: { userExists: false, username }, ip, userAgent: ua });
    return NextResponse.json({ ok: true, data: null });
  }

  const token = generateResetToken();
  await createResetRow(user.id, token);

  const baseUrl = process.env.PUBLIC_BASE_URL ?? `http://${req.headers.get('host') ?? 'localhost:5555'}`;
  const resetUrl = `${baseUrl}/reset-password?token=${encodeURIComponent(token)}`;

  let emailError: string | null = null;
  try {
    const tpl = passwordResetEmail({ username, resetUrl, expiresInMinutes: RESET_TTL_MINUTES });
    // v1: dev 模式 console 不关心 to 地址；SMTP 模式需 v2 加 users.email 列
    await sendEmail({ to: username, subject: tpl.subject, html: tpl.html, text: tpl.text });
  } catch (e) {
    if (e instanceof EmailNotConfiguredError) {
      return NextResponse.json(
        { ok: false, error: { code: 'email_not_configured', message: '邮件服务未配置' } },
        { status: 503 }
      );
    }
    emailError = e instanceof Error ? e.message : String(e);
    console.error('[forgot] email send failed', emailError);
  }

  await writeAudit({
    userId: user.id,
    event: 'password_reset_request',
    metadata: { userExists: true, emailError },
    ip,
    userAgent: ua,
  });

  return NextResponse.json({ ok: true, data: null });
}
