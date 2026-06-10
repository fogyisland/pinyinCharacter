import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { findValidResetRow } from '@/lib/password-reset';

const TOKEN_MIN = 32;

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('token') ?? '';
  if (raw.length < TOKEN_MIN) {
    return NextResponse.json(
      { ok: false, error: { code: 'invalid_token', message: '链接已失效,请重新申请' } },
      { status: 400 }
    );
  }

  const row = await findValidResetRow(raw);
  if (!row) {
    return NextResponse.json(
      { ok: false, error: { code: 'invalid_token', message: '链接已失效,请重新申请' } },
      { status: 400 }
    );
  }

  const pool = getPool();
  const [rows] = await pool.execute<any[]>(
    `SELECT username FROM users WHERE id = ? LIMIT 1`,
    [row.user_id]
  );
  if (rows.length === 0) {
    return NextResponse.json(
      { ok: false, error: { code: 'invalid_token', message: '链接已失效,请重新申请' } },
      { status: 400 }
    );
  }

  return NextResponse.json({ ok: true, data: { username: rows[0].username } });
}
