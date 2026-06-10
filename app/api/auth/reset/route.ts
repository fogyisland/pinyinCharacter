import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { hashPassword, signSession, setSessionCookie, validatePassword } from '@/lib/auth';
import { findValidResetRow, markResetUsed } from '@/lib/password-reset';
import { writeAudit } from '@/lib/audit';

interface Body { token?: string; newPassword?: string; }

export async function POST(req: NextRequest) {
  let body: Body;
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: { code: 'bad_json', message: '请求体不是合法 JSON' } }, { status: 400 }); }

  const token = body.token ?? '';
  const newPassword = body.newPassword ?? '';
  if (token.length < 32) {
    return NextResponse.json(
      { ok: false, error: { code: 'invalid_token', message: '链接已失效,请重新申请' } },
      { status: 400 }
    );
  }
  const pErr = validatePassword(newPassword);
  if (pErr) return NextResponse.json({ ok: false, error: { code: 'invalid_password', message: pErr } }, { status: 400 });

  const row = await findValidResetRow(token);
  if (!row) {
    return NextResponse.json(
      { ok: false, error: { code: 'invalid_token', message: '链接已失效,请重新申请' } },
      { status: 400 }
    );
  }

  const pool = getPool();
  const [urows] = await pool.execute<any[]>(
    `SELECT id, username FROM users WHERE id = ? LIMIT 1`,
    [row.user_id]
  );
  if (urows.length === 0) {
    return NextResponse.json(
      { ok: false, error: { code: 'invalid_token', message: '链接已失效,请重新申请' } },
      { status: 400 }
    );
  }
  const user = { id: Number(urows[0].id), username: urows[0].username as string };

  const newHash = await hashPassword(newPassword);
  await pool.execute(
    `UPDATE users SET password_hash = ? WHERE id = ?`,
    [newHash, user.id]
  );
  await markResetUsed(row.id);

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
  const ua = req.headers.get('user-agent') ?? null;
  await writeAudit({ userId: user.id, event: 'password_reset_complete', metadata: { resetId: row.id }, ip, userAgent: ua });

  const sessionToken = await signSession(user);
  await setSessionCookie(sessionToken, { secure: process.env.COOKIE_SECURE === 'true' });

  return NextResponse.json({ ok: true, data: { user } });
}
