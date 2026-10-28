import { createHash, randomBytes } from 'node:crypto';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
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

/** A row of `email_verifications` as mysql2 returns it. */
interface EmailVerificationRow extends RowDataPacket {
  id: number;
  user_id: number;
  token_hash: string;
  expires_at: Date;
  used_at: Date | null;
}

/** The columns `findVerificationStatus` selects. */
interface VerificationStatusRow extends RowDataPacket {
  email_verified_at: Date | null;
}

/**
 * Invalidate any outstanding tokens for this user (mark them used) and issue
 * a fresh one. We always want only one live token per user — older tokens
 * become invalid once a new one is sent (typical verification UX).
 */
export async function issueVerificationToken(
  userId: number,
): Promise<{ id: number; rawToken: string }> {
  const pool = getPool();
  await pool.query(
    `UPDATE email_verifications SET used_at = NOW()
     WHERE user_id = ? AND used_at IS NULL`,
    [userId],
  );
  const rawToken = generateVerifyToken();
  const hash = hashVerifyToken(rawToken);
  const [res] = await pool.query<ResultSetHeader>(
    `INSERT INTO email_verifications (user_id, token_hash, expires_at)
     VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE))`,
    [userId, hash, VERIFY_TTL_MINUTES],
  );
  return { id: Number(res.insertId), rawToken };
}

export async function findValidVerifyRow(rawToken: string): Promise<VerifyRow | null> {
  const pool = getPool();
  const hash = hashVerifyToken(rawToken);
  const [rows] = await pool.query<EmailVerificationRow[]>(
    `SELECT id, user_id, token_hash, expires_at, used_at
     FROM email_verifications
     WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW()
     ORDER BY id DESC LIMIT 1`,
    [hash],
  );
  return rows.length > 0 ? rows[0] : null;
}

export async function markVerified(userId: number): Promise<void> {
  const pool = getPool();
  // Idempotent: setting verified again is fine.
  await pool.query(
    `UPDATE users SET email_verified_at = NOW() WHERE id = ? AND email_verified_at IS NULL`,
    [userId],
  );
  // Burn any outstanding tokens for this user.
  await pool.query(
    `UPDATE email_verifications SET used_at = NOW()
     WHERE user_id = ? AND used_at IS NULL`,
    [userId],
  );
}

export async function findVerificationStatus(
  userId: number,
): Promise<{ verified: boolean; verifiedAt: Date | null }> {
  const pool = getPool();
  const [rows] = await pool.query<VerificationStatusRow[]>(
    `SELECT email_verified_at FROM users WHERE id = ? LIMIT 1`,
    [userId],
  );
  if (rows.length === 0) return { verified: false, verifiedAt: null };
  const v = rows[0].email_verified_at;
  return { verified: v !== null, verifiedAt: v };
}
