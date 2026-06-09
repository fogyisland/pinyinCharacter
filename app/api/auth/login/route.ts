import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { verifyPassword, signSession, setSessionCookie } from '@/lib/auth';
import { writeAudit } from '@/lib/audit';

interface Body { username?: string; password?: string; }

export async function POST(req: NextRequest) {
  let body: Body;
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: { code: 'bad_json', message: '请求体不是合法 JSON' } }, { status: 400 }); }

  const username = (body.username ?? '').trim();
  const password = body.password ?? '';
  if (!username || !password) {
    return NextResponse.json({ ok: false, error: { code: 'missing_fields', message: '用户名和密码必填' } }, { status: 400 });
  }

  const pool = getPool();
  const [rows] = await pool.execute<any[]>(
    `SELECT id, username, password_hash FROM users WHERE username = ? LIMIT 1`,
    [username]
  );
  const row = rows[0];
  if (!row || !(await verifyPassword(password, row.password_hash))) {
    return NextResponse.json({ ok: false, error: { code: 'bad_credentials', message: '用户名或密码错误' } }, { status: 401 });
  }

  const user = { id: Number(row.id), username: row.username };
  const token = await signSession(user);
  await setSessionCookie(token, { secure: process.env.COOKIE_SECURE === 'true' });

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
  const ua = req.headers.get('user-agent') ?? null;
  await writeAudit({ userId: user.id, event: 'login', ip, userAgent: ua });

  return NextResponse.json({ ok: true, data: { user } });
}
