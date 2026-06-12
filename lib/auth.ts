import { cookies } from 'next/headers';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { NextResponse } from 'next/server';
import { getPool } from './db';

export interface User { id: number; username: string; }
export interface SessionPayload extends JwtPayload {
  userId: number;
  username: string;
}

const COOKIE_NAME = 'auth_token';
const SESSION_DAYS = 7;

function getSecret(): string {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 32) {
    throw new Error('JWT_SECRET must be set and at least 32 chars');
  }
  return s;
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export async function signSession(user: User): Promise<string> {
  return jwt.sign(
    { userId: user.id, username: user.username },
    getSecret(),
    { algorithm: 'HS256', expiresIn: `${SESSION_DAYS}d` }
  );
}

export async function verifySession(token: string): Promise<SessionPayload | null> {
  try {
    const payload = jwt.verify(token, getSecret()) as JwtPayload;
    if (typeof payload.userId !== 'number' || typeof payload.username !== 'string') return null;
    return payload as SessionPayload;
  } catch {
    return null;
  }
}

export async function getCurrentUser(): Promise<User | null> {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token) return null;
  const session = await verifySession(token);
  if (!session) return null;
  // Check disabled_at
  const [rows] = await getPool().query<any[]>(
    `SELECT disabled_at FROM users WHERE id = ? LIMIT 1`,
    [session.userId]
  );
  if (rows.length === 0 || rows[0].disabled_at !== null) return null;
  return { id: session.userId, username: session.username };
}

export interface SetSessionCookieOptions {
  secure: boolean;
}

export async function setSessionCookie(token: string, opts: SetSessionCookieOptions): Promise<void> {
  (await cookies()).set({
    name: COOKIE_NAME,
    value: token,
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_DAYS * 24 * 60 * 60,
    secure: opts.secure,
  });
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).delete(COOKIE_NAME);
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;

/** 校验 username / password 格式（与后端共享同一规则） */
export function validateUsername(s: string): string | null {
  if (s.length < 3 || s.length > 32) return '用户名长度需 3-32 字符';
  if (!/^[a-zA-Z0-9_\-]+$/.test(s)) return '用户名只能含字母、数字、下划线、连字符';
  return null;
}

export function validatePassword(s: string): string | null {
  if (s.length < 8) return '密码至少 8 位';
  if (s.length > 72) return '密码不能超过 72 位';
  return null;
}

export interface UserWithAdmin extends User { isAdmin: boolean; }

/**
 * Same as getCurrentUser, but also queries is_admin from DB.
 * Use this whenever admin privileges need to be checked.
 * Note: is_admin is NOT in the JWT — we re-query on every request so that
 * a demoted admin loses access immediately, not at JWT expiry.
 */
export async function getCurrentUserWithAdmin(): Promise<UserWithAdmin | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const pool = getPool();
  const [rows] = await pool.execute<any[]>(
    `SELECT is_admin, disabled_at FROM users WHERE id = ? LIMIT 1`,
    [user.id]
  );
  if (rows.length === 0) return null;
  // If disabled since the last check (e.g. session was just created), return null
  if (rows[0].disabled_at !== null) return null;
  return { ...user, isAdmin: Boolean(rows[0].is_admin) };
}

export type RequireAdminResult =
  | { ok: true; user: UserWithAdmin }
  | { ok: false; reason: 'unauthenticated' | 'forbidden'; response: NextResponse };

/**
 * Discriminated guard for both API routes and server pages.
 *
 * API route usage:
 *   const auth = await requireAdmin();
 *   if (!auth.ok) return auth.response;
 *   // auth.user.id, auth.user.username, auth.user.isAdmin are safe
 *
 * Server page usage:
 *   const auth = await requireAdmin();
 *   if (!auth.ok) {
 *     if (auth.reason === 'unauthenticated') redirect('/?auth=login');
 *     else redirect('/?error=forbidden');
 *   }
 */
export async function requireAdmin(): Promise<RequireAdminResult> {
  const user = await getCurrentUserWithAdmin();
  if (!user) {
    return {
      ok: false,
      reason: 'unauthenticated',
      response: NextResponse.json(
        { ok: false, error: { code: 'unauthenticated', message: '未登录' } },
        { status: 401 }
      ),
    };
  }
  if (!user.isAdmin) {
    return {
      ok: false,
      reason: 'forbidden',
      response: NextResponse.json(
        { ok: false, error: { code: 'forbidden', message: '需要管理员权限' } },
        { status: 403 }
      ),
    };
  }
  return { ok: true, user };
}
