import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import {
  getCurrentUser,
  hashPassword,
  verifyPassword,
  validatePassword,
  clearSessionCookie,
} from '@/lib/auth';
import { writeAudit } from '@/lib/audit';

/**
 * Change the signed-in user's own password.
 *
 * The only ways to change a password before this route existed were the
 * forgot-password email flow (needs access to the mailbox) and an admin
 * resetting it from the admin panel (needs admin rights). A user who has
 * simply forgotten their password while sitting in front of the app was
 * stuck until somebody with admin rights intervened.
 *
 * ⚠️ The CURRENT password is required and must verify. Without that check
 * this endpoint would be a free password reset for anyone who finds an
 * open session on a shared machine — and the audit trail would say the
 * user changed their own password when they did not.
 *
 * The session cookie is cleared on success. A password change is how a
 * user responds to a suspected compromise, and keeping the old session
 * alive would leave the attacker's session working for another 7 days.
 * The user signs in again with the new password.
 */

interface Body {
  currentPassword?: string;
  newPassword?: string;
}

interface PasswordRow extends RowDataPacket {
  password_hash: string;
}

function errorResponse(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ ok: false, error: { code, message } }, { status });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return errorResponse(401, 'unauthorized', '请先登录');
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return errorResponse(400, 'bad_json', '请求体不是合法 JSON');
  }

  const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';
  const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';

  if (!currentPassword) {
    return errorResponse(400, 'missing_current_password', '请输入当前密码');
  }

  // The same rule the register and reset routes apply, so a password can
  // never be set here that those routes would refuse.
  const passwordError = validatePassword(newPassword);
  if (passwordError) {
    return errorResponse(400, 'invalid_password', passwordError);
  }

  const pool = getPool();
  const [rows] = await pool.query<PasswordRow[]>(
    `SELECT password_hash FROM users WHERE id = ? LIMIT 1`,
    [user.id],
  );
  if (rows.length === 0) {
    return errorResponse(404, 'not_found', '账号不存在');
  }

  const matches = await verifyPassword(currentPassword, rows[0].password_hash);
  if (!matches) {
    return errorResponse(400, 'wrong_password', '当前密码不正确');
  }

  const newHash = await hashPassword(newPassword);
  await pool.query(`UPDATE users SET password_hash = ? WHERE id = ?`, [newHash, user.id]);

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
  const userAgent = req.headers.get('user-agent') ?? null;
  await writeAudit({
    userId: user.id,
    event: 'password_changed',
    metadata: { username: user.username },
    ip,
    userAgent,
  });

  // The old session stops working here. The user signs in again with the
  // new password.
  await clearSessionCookie();

  return NextResponse.json({ ok: true, data: { changed: true } });
}
