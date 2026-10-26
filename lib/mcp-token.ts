import { createHash, randomBytes } from 'node:crypto';
import type { RowDataPacket } from 'mysql2';
import { getPool } from './db';

/**
 * The prefix every MCP bearer token carries.
 *
 * It is a recognisable marker (a leaked token can be spotted in a log or a
 * config file) and it keeps the raw token from being mistaken for a
 * session JWT.
 */
export const MCP_TOKEN_PREFIX = 'mcp_';

/**
 * A fresh raw MCP token.
 *
 * 32 random bytes in base64url: 43 characters of entropy-safe alphabet
 * plus the 4-character prefix = 47 characters. `randomBytes` is
 * cryptographically secure, which matters because this string is the
 * only thing standing between a leaked token and someone's account.
 */
export function generateMcpToken(): string {
  return MCP_TOKEN_PREFIX + randomBytes(32).toString('base64url');
}

/**
 * The digest stored in the database instead of the raw token.
 *
 * SHA-256 over the UTF-8 bytes, hex encoded — 64 characters, the same
 * shape as password_resets.token_hash. A stolen database therefore hands
 * the attacker digests, not usable credentials.
 */
export function hashMcpToken(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

/** Where a user's token stands. */
export type McpTokenState = 'none' | 'active' | 'revoked';

/**
 * The token status of one user.
 *
 * The timestamps are ISO strings, not Date objects: this object goes
 * straight into a JSON response.
 */
export interface McpTokenStatus {
  state: McpTokenState;
  createdAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

/** The owner a raw token belongs to. */
export interface ResolvedToken {
  userId: number;
  username: string;
  isAdmin: boolean;
}

/** How often `last_used_at` may be rewritten (one hour). */
const LAST_USED_THROTTLE_MS = 3_600_000;

interface McpTokenRow extends RowDataPacket {
  user_id: number;
  token_hash: string;
  created_at: Date;
  last_used_at: Date | null;
  revoked_at: Date | null;
}

interface ResolvedTokenRow extends RowDataPacket {
  user_id: number;
  username: string;
  is_admin: number;
  last_used_at: Date | null;
}

/**
 * mysql2 hands DATETIME / TIMESTAMP back as a JS Date, but the driver can be
 * configured to hand back strings — normalise both into a Date so the
 * comparisons below never compare a string with a number.
 */
function toDate(value: Date | string | null): Date | null {
  if (value === null) return null;
  return value instanceof Date ? value : new Date(value);
}

/** The outward-facing shape of a timestamp: an ISO string, or nothing. */
function iso(value: Date | string | null): string | null {
  const date = toDate(value);
  return date ? date.toISOString() : null;
}

/**
 * The token status of one user.
 *
 * 'none' means the user has never held a token; 'revoked' means the row is
 * still there but the token is dead. The row is never deleted on revoke, so
 * the audit trail of "this user had a token" survives.
 */
export async function getTokenStatus(userId: number): Promise<McpTokenStatus> {
  const [rows] = await getPool().query<McpTokenRow[]>(
    'SELECT created_at, last_used_at, revoked_at FROM mcp_tokens WHERE user_id = ? LIMIT 1',
    [userId],
  );
  const row = rows[0];
  if (!row) return { state: 'none', createdAt: null, lastUsedAt: null, revokedAt: null };
  return {
    state: row.revoked_at ? 'revoked' : 'active',
    createdAt: iso(row.created_at),
    lastUsedAt: iso(row.last_used_at),
    revokedAt: iso(row.revoked_at),
  };
}

/**
 * Hand a user a token, rotating the previous one if there was one.
 *
 * The table has one row per user, so the upsert replaces the old digest in
 * place: the previous token stops resolving the moment this returns, and
 * the previous `last_used_at` / `revoked_at` are cleared with it.
 *
 * `replaced` tells the caller whether this was a first issue or a rotation.
 * The API route uses it to pick the audit event; it is never part of the
 * response body.
 */
export async function issueToken(userId: number): Promise<{
  raw: string;
  createdAt: string;
  replaced: boolean;
}> {
  const pool = getPool();
  const [existing] = await pool.query<McpTokenRow[]>(
    'SELECT id FROM mcp_tokens WHERE user_id = ? LIMIT 1',
    [userId],
  );
  const replaced = existing.length > 0;

  const raw = generateMcpToken();
  await pool.query(
    `INSERT INTO mcp_tokens (user_id, token_hash)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE
       token_hash = VALUES(token_hash),
       created_at = CURRENT_TIMESTAMP,
       last_used_at = NULL,
       revoked_at = NULL`,
    [userId, hashMcpToken(raw)],
  );

  const [rows] = await pool.query<McpTokenRow[]>(
    'SELECT created_at FROM mcp_tokens WHERE user_id = ? LIMIT 1',
    [userId],
  );
  const createdAt = iso(rows[0]?.created_at ?? null) ?? new Date().toISOString();
  return { raw, createdAt, replaced };
}

/**
 * Revoke a user's token.
 *
 * Idempotent by design: revoking an already-revoked token keeps the
 * original timestamp instead of moving it, and revoking a user who never
 * had a token reports `null` rather than failing. The endpoint therefore
 * never answers 404.
 */
export async function revokeToken(userId: number): Promise<{ revokedAt: string | null }> {
  const pool = getPool();
  await pool.query(
    'UPDATE mcp_tokens SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL',
    [userId],
  );
  const [rows] = await pool.query<McpTokenRow[]>(
    'SELECT revoked_at FROM mcp_tokens WHERE user_id = ? LIMIT 1',
    [userId],
  );
  return { revokedAt: iso(rows[0]?.revoked_at ?? null) };
}

/**
 * Find the owner of a raw token.
 *
 * Returns `null` for an unknown token, a revoked token and a token whose
 * account has been disabled — the caller cannot tell those apart, and does
 * not need to.
 */
export async function resolveToken(raw: string): Promise<ResolvedToken | null> {
  const pool = getPool();
  const [rows] = await pool.query<ResolvedTokenRow[]>(
    `SELECT t.user_id, u.username, u.is_admin, t.last_used_at
     FROM mcp_tokens t
     JOIN users u ON u.id = t.user_id
     WHERE t.token_hash = ? AND t.revoked_at IS NULL AND u.disabled_at IS NULL
     LIMIT 1`,
    [hashMcpToken(raw)],
  );
  const row = rows[0];
  if (!row) return null;

  await touchLastUsed(Number(row.user_id), row.last_used_at);

  return {
    userId: Number(row.user_id),
    username: row.username,
    isAdmin: Boolean(row.is_admin),
  };
}

/**
 * Stamp the last use of a token, at most once an hour.
 *
 * Every MCP call would otherwise write a row, which turns a hot endpoint
 * into a write-heavy one for a value nobody reads more often than hourly.
 */
async function touchLastUsed(userId: number, lastUsedAt: Date | null): Promise<void> {
  const previous = toDate(lastUsedAt);
  const isDue = previous === null || previous.getTime() < Date.now() - LAST_USED_THROTTLE_MS;
  if (!isDue) return;
  await getPool().query('UPDATE mcp_tokens SET last_used_at = NOW() WHERE user_id = ?', [userId]);
}
