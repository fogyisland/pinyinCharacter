import { createHash, randomBytes } from 'node:crypto';
import { getPool } from './db';

export const VERIFY_TTL_MINUTES = 60 * 24; // 24h — generous so users don't lose the email
export const TOKEN_MIN_LENGTH = 32;

export function generateVerifyToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashVerifyToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export interface VerifyRow {
  id: number;
  user_id: number;
  token_hash: string;
  expires_at: Date;
  used_at: Date | null;
}

/**
 * Invalidate any outstanding tokens for this user (mark them used) and issue
 * a fresh one. We always want only one live token per user — older tokens
 * become invalid once a new one is sent (typical verification UX).
 */
export async function issueVerificationToken(userId: number): Promise<{ id: number; rawToken: string }> {
  const pool = getPool();
  await pool.execute(
    `UPDATE email_verifications SET used_at = NOW()
     WHERE user_id = ? AND used_at IS NULL`,
    [userId]
  );
  const rawToken = generateVerifyToken();
  const hash = hashVerifyToken(rawToken);
  const [res] = await pool.execute<any>(
    `INSERT INTO email_verifications (user_id, token_hash, expires_at)
     VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE))`,
    [userId, hash, VERIFY_TTL_MINUTES]
  );
  return { id: Number(res.insertId), rawToken };
}

export async function findValidVerifyRow(rawToken: string): Promise<VerifyRow | null> {
  const pool = getPool();
  const hash = hashVerifyToken(rawToken);
  const [rows] = await pool.execute<any[]>(
    `SELECT id, user_id, token_hash, expires_at, used_at
     FROM email_verifications
     WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW()
     ORDER BY id DESC LIMIT 1`,
    [hash]
  );
  return rows.length > 0 ? (rows[0] as VerifyRow) : null;
}

export async function markVerified(userId: number): Promise<void> {
  const pool = getPool();
  // Idempotent: setting verified again is fine.
  await pool.execute(
    `UPDATE users SET email_verified_at = NOW() WHERE id = ? AND email_verified_at IS NULL`,
    [userId]
  );
  // Burn any outstanding tokens for this user.
  await pool.execute(
    `UPDATE email_verifications SET used_at = NOW()
     WHERE user_id = ? AND used_at IS NULL`,
    [userId]
  );
}

export async function findVerificationStatus(userId: number): Promise<{ verified: boolean; verifiedAt: Date | null }> {
  const pool = getPool();
  const [rows] = await pool.execute<any[]>(
    `SELECT email_verified_at FROM users WHERE id = ? LIMIT 1`,
    [userId]
  );
  if (rows.length === 0) return { verified: false, verifiedAt: null };
  const v = rows[0].email_verified_at as Date | null;
  return { verified: v !== null, verifiedAt: v };
}