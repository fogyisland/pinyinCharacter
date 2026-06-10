import { createHash, randomBytes } from 'node:crypto';
import { getPool } from './db';

export const RESET_TTL_MINUTES = 15;
export const TOKEN_MIN_LENGTH = 32;

export function generateResetToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashResetToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export interface ResetRow {
  id: number;
  user_id: number;
  token_hash: string;
  expires_at: Date;
  used_at: Date | null;
}

export async function createResetRow(userId: number, rawToken: string): Promise<number> {
  const pool = getPool();
  const hash = hashResetToken(rawToken);
  const [res] = await pool.execute<any>(
    `INSERT INTO password_resets (user_id, token_hash, expires_at)
     VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE))`,
    [userId, hash, RESET_TTL_MINUTES]
  );
  return Number(res.insertId);
}

export async function findValidResetRow(rawToken: string): Promise<ResetRow | null> {
  const pool = getPool();
  const hash = hashResetToken(rawToken);
  const [rows] = await pool.execute<any[]>(
    `SELECT id, user_id, token_hash, expires_at, used_at
     FROM password_resets
     WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW()
     ORDER BY id DESC LIMIT 1`,
    [hash]
  );
  return rows.length > 0 ? (rows[0] as ResetRow) : null;
}

export async function markResetUsed(id: number): Promise<void> {
  const pool = getPool();
  await pool.execute(
    `UPDATE password_resets SET used_at = NOW() WHERE id = ?`,
    [id]
  );
}

export async function findUserByUsername(username: string): Promise<{ id: number } | null> {
  // v1: 表里没有 email 字段；SMTP mode 下需要把用户的真实 email 路径在 v2 加进 schema
  const pool = getPool();
  const [rows] = await pool.execute<any[]>(
    `SELECT id FROM users WHERE username = ? LIMIT 1`,
    [username]
  );
  if (rows.length === 0) return null;
  return { id: Number(rows[0].id) };
}
