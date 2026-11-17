import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import { verifyPassword, signSession, setSessionCookie } from '@/lib/auth';
import { writeAudit } from '@/lib/audit';
import { checkAttemptLimit, resetAttemptLimit } from '@/lib/ratelimit';
import bcrypt from 'bcryptjs';

interface Body {
  username?: string;
  password?: string;
}

interface UserAuthRow extends RowDataPacket {
  id: number;
  username: string;
  password_hash: string;
  is_admin: number | boolean;
  disabled_at: Date | null;
}

/** Attempts allowed per IP per window. */
const MAX_IP_ATTEMPTS = 10;
/** Attempts allowed per account per window — this is the brute-force limit. */
const MAX_ACCOUNT_ATTEMPTS = 5;
/** The window both budgets are measured over. */
const WINDOW_MS = 15 * 60 * 1000;

/**
 * A bcrypt hash of a value nobody can supply, used to equalize the time a
 * login attempt takes.
 *
 * Without it, a request for a username that does not exist returned in
 * ~1 ms (the `verifyPassword` call was skipped entirely) while a request
 * for a username that DOES exist took ~110 ms (bcrypt cost 10). That gap
 * is the classic user-enumeration oracle: an attacker measures the
 * response time and learns which usernames are real.
 *
 * Comparing against this hash when the account is missing costs the same
 * as a real comparison, so both paths take the same time.
 */
const DUMMY_HASH = bcrypt.hashSync('a-password-that-no-user-can-supply', 10);

function clientIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: 'bad_json', message: '请求体不是合法 JSON' } },
      { status: 400 },
    );
  }

  const username = (body.username ?? '').trim();
  const password = body.password ?? '';
  if (!username || !password) {
    return NextResponse.json(
      { ok: false, error: { code: 'missing_fields', message: '用户名和密码必填' } },
      { status: 400 },
    );
  }

  // Two budgets, because they defend against different attacks:
  //   - per IP       → stops one host from spraying many accounts.
  //   - per ACCOUNT  → stops a distributed spray against one account.
  // Both must pass. The per-account key is salted with the username so
  // that the in-memory map cannot be used to enumerate which usernames
  // exist.
  const ip = clientIp(req);
  const ipLimit = checkAttemptLimit(`login:ip:${ip}`, MAX_IP_ATTEMPTS, WINDOW_MS);
  if (!ipLimit.allowed) {
    return NextResponse.json(
      { ok: false, error: { code: 'rate_limited', message: '尝试过于频繁,请稍后再试' } },
      { status: 429 },
    );
  }
  const accountKey = `login:account:${username}`;
  const accountLimit = checkAttemptLimit(accountKey, MAX_ACCOUNT_ATTEMPTS, WINDOW_MS);
  if (!accountLimit.allowed) {
    await writeAudit({
      userId: null,
      event: 'login_rate_limited',
      metadata: { username },
      ip,
      userAgent: req.headers.get('user-agent') ?? null,
    });
    return NextResponse.json(
      { ok: false, error: { code: 'rate_limited', message: '尝试过于频繁,请稍后再试' } },
      { status: 429 },
    );
  }

  const pool = getPool();
  const [rows] = await pool.query<UserAuthRow[]>(
    `SELECT id, username, password_hash, is_admin, disabled_at FROM users WHERE username = ? LIMIT 1`,
    [username],
  );
  const row = rows[0];
  // Compare against the dummy hash when the account does not exist, so
  // both branches cost the same ~110 ms. See DUMMY_HASH above.
  const passwordOk = await (row
    ? verifyPassword(password, row.password_hash)
    : bcrypt.compare(password, DUMMY_HASH));
  if (!row || !passwordOk) {
    return NextResponse.json(
      { ok: false, error: { code: 'bad_credentials', message: '用户名或密码错误' } },
      { status: 401 },
    );
  }

  // A disabled account and a wrong password answer identically from here
  // on. The distinction used to be a second oracle: a 403 with code
  // `account_disabled` told an attacker that this username exists AND is
  // banned, while a nonexistent username answered 401.
  //
  // The disabled case still fails — it just fails with the same 401 and
  // the same body as a wrong password. The administrator sees the real
  // reason in the audit log and in /admin/users.
  if (row.disabled_at !== null) {
    await writeAudit({
      userId: Number(row.id),
      event: 'login_disabled',
      ip,
      userAgent: req.headers.get('user-agent') ?? null,
    });
    return NextResponse.json(
      { ok: false, error: { code: 'bad_credentials', message: '用户名或密码错误' } },
      { status: 401 },
    );
  }

  // The login succeeded: clear the account's attempt budget so a user who
  // mistyped twice is not left one attempt away from a lockout.
  resetAttemptLimit(accountKey);

  const user = { id: Number(row.id), username: row.username, isAdmin: Boolean(row.is_admin) };
  const token = await signSession(user);
  await setSessionCookie(token, { secure: process.env.COOKIE_SECURE === 'true' });

  const ua = req.headers.get('user-agent') ?? null;
  await writeAudit({ userId: user.id, event: 'login', ip, userAgent: ua });

  return NextResponse.json({ ok: true, data: { user } });
}
