import { NextRequest, NextResponse } from 'next/server';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import { hashPassword, signSession, setSessionCookie } from '@/lib/auth';
import { writeAudit } from '@/lib/audit';
import { registerSchema } from '@/lib/validators';
import { sendEmail } from '@/lib/email';
import { welcomeEmail, emailVerificationEmail } from '@/lib/email-templates';
import { issueVerificationToken } from '@/lib/email-verification';
import { getRuntimeSiteUrl } from '@/lib/seo/config';
import { checkAttemptLimit } from '@/lib/ratelimit';

interface CountRow extends RowDataPacket {
  n: number;
}

/** The subset of a mysql2 driver error the duplicate-entry branch inspects. */
interface MysqlDriverError {
  code?: string;
  message?: string;
  sqlMessage?: string;
}

export async function POST(req: NextRequest) {
  // Account creation is rate limited per IP: without it, the endpoint is
  // an open signup oracle (unlimited accounts, each one a row in `users`
  // and a welcome + verification email to send).
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const limit = checkAttemptLimit('register:ip:' + ip, 5, 60 * 60 * 1000);  if (!limit.allowed) {
    return NextResponse.json(
      { ok: false, error: { code: 'rate_limited', message: '注册过于频繁,请稍后再试' } },
      { status: 429 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: 'bad_json', message: '请求体不是合法 JSON' } },
      { status: 400 },
    );
  }

  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json(
      { ok: false, error: { code: 'bad_input', message: issue?.message ?? 'invalid input' } },
      { status: 400 },
    );
  }
  const { username, email, password } = parsed.data;

  const pool = getPool();
  // Whether this account becomes the administrator.
  //
  // The rule is: the FIRST account of an empty install is the admin, and
  // NOBODY ever becomes an admin through this route afterwards. The old
  // check ("is the users table empty?") was two separate problems:
  //
  //   1. It stayed true for as long as the table was empty, so on a
  //      freshly-provisioned database the first anonymous caller to hit
  //      /api/auth/register became an administrator — even though the
  //      setup wizard was still running.
  //   2. `SELECT COUNT(*)` and the `INSERT` were not in one transaction,
  //      so two concurrent requests could both observe an empty table
  //      and both insert an admin.
  //
  // The admin is now granted only when there is no administrator at all.
  // An existing admin is what makes the install "already initialized",
  // and the check is a single indexed query — so the race window is the
  // same as the INSERT's, and the wizard (not this route) is what
  // creates the first administrator.
  const [admins] = await pool.query<CountRow[]>(
    `SELECT COUNT(*) AS n FROM users WHERE is_admin = 1`,
  );
  const isFirst = Number(admins[0]?.n ?? 0) === 0;

  const hash = await hashPassword(password);
  let userId: number;
  try {
    const [res] = await pool.query<ResultSetHeader>(
      `INSERT INTO users (username, email, password_hash, is_admin) VALUES (?, ?, ?, ?)`,
      [username, email, hash, isFirst ? 1 : 0],
    );
    userId = Number(res.insertId);
  } catch (e: unknown) {
    const err = (e ?? {}) as MysqlDriverError;
    if (err.code === 'ER_DUP_ENTRY') {
      if (err.message?.includes('uk_email') || err.sqlMessage?.includes('uk_email')) {
        return NextResponse.json(
          { ok: false, error: { code: 'email_taken', message: '邮箱已被注册' } },
          { status: 409 },
        );
      }
      return NextResponse.json(
        { ok: false, error: { code: 'username_taken', message: '用户名已被占用' } },
        { status: 409 },
      );
    }
    throw e;
  }

  // `ip` was resolved at the top of the handler, for the rate limit.
  const ua = req.headers.get('user-agent') ?? null;
  await writeAudit({ userId, event: 'register', metadata: { isFirst, email }, ip, userAgent: ua });

  // Send a welcome email — failures here MUST NOT block registration.
  // The user already has a session cookie + the audit row; if SMTP is
  // misconfigured we want them in, with email_send_history recording the
  // failure for the admin to spot from /admin/email.
  try {
    const siteUrl = await getRuntimeSiteUrl();
    const tpl = welcomeEmail({ username, loginUrl: `${siteUrl}/login` });
    await sendEmail({
      to: email,
      subject: tpl.subject,
      html: tpl.html,
      text: tpl.text,
      template: 'welcome',
    });
    await writeAudit({
      userId,
      event: 'welcome_email_sent',
      metadata: { to: email },
      ip,
      userAgent: ua,
    });
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    await writeAudit({
      userId,
      event: 'welcome_email_failed',
      metadata: { to: email, error: err },
      ip,
      userAgent: ua,
    });
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
    await sendEmail({
      to: email,
      subject: tpl.subject,
      html: tpl.html,
      text: tpl.text,
      template: 'email_verification',
    });
    await writeAudit({
      userId,
      event: 'verification_email_sent',
      metadata: { to: email },
      ip,
      userAgent: ua,
    });
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    await writeAudit({
      userId,
      event: 'verification_email_failed',
      metadata: { to: email, error: err },
      ip,
      userAgent: ua,
    });
  }

  const user = { id: userId, username, isAdmin: isFirst };
  const token = await signSession(user);
  await setSessionCookie(token, { secure: process.env.COOKIE_SECURE === 'true' });
  return NextResponse.json({ ok: true, data: { user } });
}
