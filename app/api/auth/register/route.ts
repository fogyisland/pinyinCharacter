import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import {
  hashPassword, signSession, setSessionCookie,
  validateUsername, validatePassword,
} from '@/lib/auth';
import { writeAudit } from '@/lib/audit';

interface Body { username?: string; password?: string; }

export async function POST(req: NextRequest) {
  let body: Body;
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: { code: 'bad_json', message: '请求体不是合法 JSON' } }, { status: 400 }); }

  const username = (body.username ?? '').trim();
  const password = body.password ?? '';
  const uErr = validateUsername(username);
  if (uErr) return NextResponse.json({ ok: false, error: { code: 'invalid_username', message: uErr } }, { status: 400 });
  const pErr = validatePassword(password);
  if (pErr) return NextResponse.json({ ok: false, error: { code: 'invalid_password', message: pErr } }, { status: 400 });

  const pool = getPool();
  const [rows] = await pool.execute<any[]>(`SELECT COUNT(*) AS n FROM users`);
  const isFirst = Number(rows[0]?.n ?? 0) === 0;

  const hash = await hashPassword(password);
  let userId: number;
  try {
    const [res] = await pool.execute<any>(
      `INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, ?)`,
      [username, hash, isFirst ? 1 : 0]
    );
    userId = Number(res.insertId);
  } catch (e: any) {
    if (e?.code === 'ER_DUP_ENTRY') {
      return NextResponse.json({ ok: false, error: { code: 'username_taken', message: '用户名已被占用' } }, { status: 409 });
    }
    throw e;
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
  const ua = req.headers.get('user-agent') ?? null;
  await writeAudit({ userId, event: 'register', metadata: { isFirst }, ip, userAgent: ua });

  const user = { id: userId, username };
  const token = await signSession(user);
  await setSessionCookie(token, { secure: process.env.COOKIE_SECURE === 'true' });
  return NextResponse.json({ ok: true, data: { user } });
}
