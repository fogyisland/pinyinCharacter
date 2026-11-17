import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import { findValidResetRow } from '@/lib/password-reset';
import { checkAttemptLimit } from '@/lib/ratelimit';

/** Reset-token lookups allowed per IP per window. */
const MAX_IP_ATTEMPTS = 20;
/** The window the lookup budget is measured over. */
const WINDOW_MS = 15 * 60 * 1000;

const TOKEN_MIN = 32;

interface UsernameRow extends RowDataPacket {
  username: string;
}

export async function GET(req: NextRequest) {
  // Rate limit per IP. This route is unauthenticated and answers
  // "is this token live, and whose is it" — an oracle worth bounding.
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const limit = checkAttemptLimit(`reset-info:ip:${ip}`, MAX_IP_ATTEMPTS, WINDOW_MS);
  if (!limit.allowed) {
    return NextResponse.json(
      { ok: false, error: { code: 'rate_limited', message: '尝试过于频繁,请稍后再试' } },
      { status: 429 },
    );
  }

  const raw = req.nextUrl.searchParams.get('token') ?? '';
  if (raw.length < TOKEN_MIN) {
    return NextResponse.json(
      { ok: false, error: { code: 'invalid_token', message: '链接已失效,请重新申请' } },
      { status: 400 },
    );
  }

  const row = await findValidResetRow(raw);
  if (!row) {
    return NextResponse.json(
      { ok: false, error: { code: 'invalid_token', message: '链接已失效,请重新申请' } },
      { status: 400 },
    );
  }

  const pool = getPool();
  const [rows] = await pool.query<UsernameRow[]>(`SELECT username FROM users WHERE id = ? LIMIT 1`, [
    row.user_id,
  ]);
  if (rows.length === 0) {
    return NextResponse.json(
      { ok: false, error: { code: 'invalid_token', message: '链接已失效,请重新申请' } },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true, data: { username: rows[0].username } });
}
