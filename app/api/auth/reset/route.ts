import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import { hashPassword, signSession, setSessionCookie, validatePassword } from '@/lib/auth';
import { findValidResetRow, markResetUsed } from '@/lib/password-reset';
import { writeAudit } from '@/lib/audit';
import { checkAttemptLimit } from '@/lib/ratelimit';

/** Reset attempts allowed per IP per window. */
const MAX_IP_ATTEMPTS = 10;
/** The window the reset budget is measured over. */
const WINDOW_MS = 15 * 60 * 1000;

interface Body {
  token?: string;
  newPassword?: string;
}

interface ResetUserRow extends RowDataPacket {
  id: number;
  username: string;
}

export async function POST(req: NextRequest) {
  // Rate limit per IP. The reset token is 32 random bytes, so guessing
  // it is not the threat; but this route also WRITES the account's
  // password, so an unbounded endpoint is a target worth hammering and
  // a cheap way to keep the database busy.
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const limit = checkAttemptLimit(`reset:ip:${ip}`, MAX_IP_ATTEMPTS, WINDOW_MS);
  if (!limit.allowed) {
    return NextResponse.json(
      { ok: false, error: { code: 'rate_limited', message: '尝试过于频繁,请稍后再试' } },
      { status: 429 },
    );
  }

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: 'bad_json', message: '请求体不是合法 JSON' } },
      { status: 400 },
    );
  }

  const token = body.token ?? '';
  const newPassword = body.newPassword ?? '';
  if (token.length < 32) {
    return NextResponse.json(
      { ok: false, error: { code: 'invalid_token', message: '链接已失效,请重新申请' } },
      { status: 400 },
    );
  }
  const pErr = validatePassword(newPassword);
  if (pErr)
    return NextResponse.json(
      { ok: false, error: { code: 'invalid_password', message: pErr } },
      { status: 400 },
    );

  const row = await findValidResetRow(token);
  if (!row) {
    return NextResponse.json(
      { ok: false, error: { code: 'invalid_token', message: '链接已失效,请重新申请' } },
      { status: 400 },
    );
  }

  const pool = getPool();
  const [urows] = await pool.query<ResetUserRow[]>(
    `SELECT id, username FROM users WHERE id = ? LIMIT 1`,
    [row.user_id],
  );
  if (urows.length === 0) {
    return NextResponse.json(
      { ok: false, error: { code: 'invalid_token', message: '链接已失效,请重新申请' } },
      { status: 400 },
    );
  }
  const user = { id: Number(urows[0].id), username: urows[0].username };

  const newHash = await hashPassword(newPassword);
  await pool.query(`UPDATE users SET password_hash = ? WHERE id = ?`, [newHash, user.id]);
  await markResetUsed(row.id);

  // `ip` was resolved at the top of the handler, for the rate limit.
  const ua = req.headers.get('user-agent') ?? null;
  await writeAudit({
    userId: user.id,
    event: 'password_reset_complete',
    metadata: { resetId: row.id },
    ip,
    userAgent: ua,
  });

  const sessionToken = await signSession(user);
  await setSessionCookie(sessionToken, { secure: process.env.COOKIE_SECURE === 'true' });

  return NextResponse.json({ ok: true, data: { user } });
}
