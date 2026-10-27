import { getPool } from './db';
import type { RowDataPacket } from 'mysql2';

/**
 * The admin's view of the MCP token table.
 *
 * `lib/mcp-token.ts` owns the token lifecycle — issue, resolve, revoke —
 * and answers to one user at a time. This module answers the other
 * question: *who* holds a token, and what is the state of all of them.
 *
 * The table has one row per user (`UNIQUE KEY uniq_mcp_tokens_user`), so
 * the list of token holders is at most as long as the user table.
 */

/** Whether a token is still usable. */
export type AdminMcpTokenState = 'active' | 'revoked';

/** Which tokens a list should contain. */
export type AdminMcpTokenFilter = 'all' | 'active' | 'revoked';

/** One token holder, as the admin page shows it. */
export interface AdminMcpTokenRow {
  userId: number;
  username: string;
  isAdmin: boolean;
  /** The account is disabled, so its token cannot be used even if active. */
  disabled: boolean;
  state: AdminMcpTokenState;
  /** ISO string — the moment the token was issued. */
  createdAt: string;
  /** ISO string — the last time the token authenticated a request. */
  lastUsedAt: string | null;
  /** ISO string — the moment the token was revoked. */
  revokedAt: string | null;
}

/** The counters above the admin list. */
export interface AdminMcpTokenStats {
  /** Every registered user, token or not. */
  totalUsers: number;
  /** Every user who has ever held a token, revoked or not. */
  holders: number;
  /** Tokens that are neither revoked nor held by a disabled account. */
  active: number;
  /** Tokens that have been revoked. */
  revoked: number;
  /** Tokens that authenticated a request in the last 30 days. */
  usedRecently: number;
}

/** The options of the admin list. */
export interface ListAdminMcpTokensOptions {
  /** Which tokens to list. Defaults to every one. */
  state?: AdminMcpTokenFilter;
  /** A username fragment to match. */
  q?: string;
  limit?: number;
  offset?: number;
}

/** One page of token holders. */
export interface ListAdminMcpTokensResult {
  items: AdminMcpTokenRow[];
  total: number;
}

/** The row shape of the token queries. */
interface AdminMcpTokenRowData extends RowDataPacket {
  user_id: number;
  username: string;
  is_admin: number;
  disabled_epoch: number | null;
  created_epoch: number | null;
  last_used_epoch: number | null;
  revoked_epoch: number | null;
}

/** The row shape of the counters query. */
interface AdminMcpTokenStatsRow extends RowDataPacket {
  total_users: number;
  holders: number;
  active: number;
  revoked: number;
  used_recently: number;
}

/**
 * A Unix timestamp in seconds, the way MySQL's UNIX_TIMESTAMP() returns it.
 */
type EpochSeconds = number | null;

/**
 * The outward-facing shape of a timestamp: an ISO string, or nothing.
 *
 * The epoch is read on the database side, so it is in the database's own
 * session time zone — the same rule `lib/mcp-token.ts` follows.
 */
function isoFromEpoch(epoch: EpochSeconds): string | null {
  return epoch === null ? null : new Date(epoch * 1000).toISOString();
}

/**
 * The WHERE clause of the list query, and the parameters it binds.
 *
 * The count query runs the same clause, so the total and the page can
 * never disagree.
 */
function buildFilter(opts: ListAdminMcpTokensOptions): { whereSql: string; params: unknown[] } {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.state === 'active') {
    where.push('t.revoked_at IS NULL');
  } else if (opts.state === 'revoked') {
    where.push('t.revoked_at IS NOT NULL');
  }
  if (opts.q) {
    where.push('u.username LIKE ?');
    params.push(`%${opts.q}%`);
  }
  return { whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

/**
 * One page of the token holders.
 *
 * Ordered by the issue time, newest first — the same order the user's own
 * token list uses, and the order an operator expects: the newest tokens
 * first.
 */
export async function listAdminMcpTokens(
  opts: ListAdminMcpTokensOptions = {},
): Promise<ListAdminMcpTokensResult> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  const pool = getPool();
  const { whereSql, params } = buildFilter(opts);

  const [rows, countRows] = await Promise.all([
    pool
      .query<AdminMcpTokenRowData[]>(
        `SELECT t.user_id, u.username, u.is_admin,
                UNIX_TIMESTAMP(u.disabled_at) AS disabled_epoch,
                UNIX_TIMESTAMP(t.created_at) AS created_epoch,
                UNIX_TIMESTAMP(t.last_used_at) AS last_used_epoch,
                UNIX_TIMESTAMP(t.revoked_at) AS revoked_epoch
         FROM mcp_tokens t
         JOIN users u ON u.id = t.user_id
         ${whereSql}
         ORDER BY t.created_at DESC, t.user_id DESC
         LIMIT ? OFFSET ?`,
        [...params, limit, offset],
      )
      .then(([result]) => result),
    pool
      .query<RowDataPacket[]>(
        `SELECT COUNT(*) AS n
         FROM mcp_tokens t
         JOIN users u ON u.id = t.user_id
         ${whereSql}`,
        params,
      )
      .then(([result]) => result),
  ]);

  const items: AdminMcpTokenRow[] = rows.map((r) => {
    const revokedAt = isoFromEpoch(r.revoked_epoch);
    return {
      userId: Number(r.user_id),
      username: r.username,
      isAdmin: Boolean(r.is_admin),
      disabled: r.disabled_epoch !== null,
      state: revokedAt ? 'revoked' : 'active',
      createdAt: isoFromEpoch(r.created_epoch) ?? new Date().toISOString(),
      lastUsedAt: isoFromEpoch(r.last_used_epoch),
      revokedAt,
    };
  });

  return { items, total: Number(countRows[0]?.n ?? 0) };
}

/**
 * The counters above the admin list.
 *
 * `active` counts the tokens that are not revoked. A token held by a
 * disabled account cannot authenticate anything — `resolveToken()` joins
 * on `u.disabled_at IS NULL` — but it is still an un-revoked row, and the
 * operator needs to see it in order to revoke it.
 */
export async function getAdminMcpTokenStats(): Promise<AdminMcpTokenStats> {
  const [rows] = await getPool().query<AdminMcpTokenStatsRow[]>(
    `SELECT
       (SELECT COUNT(*) FROM users) AS total_users,
       (SELECT COUNT(*) FROM mcp_tokens) AS holders,
       (SELECT COUNT(*) FROM mcp_tokens WHERE revoked_at IS NULL) AS active,
       (SELECT COUNT(*) FROM mcp_tokens WHERE revoked_at IS NOT NULL) AS revoked,
       (SELECT COUNT(*) FROM mcp_tokens
        WHERE last_used_at IS NOT NULL AND last_used_at >= NOW() - INTERVAL 30 DAY
       ) AS used_recently`,
  );
  const r = rows[0];
  return {
    totalUsers: Number(r?.total_users ?? 0),
    holders: Number(r?.holders ?? 0),
    active: Number(r?.active ?? 0),
    revoked: Number(r?.revoked ?? 0),
    usedRecently: Number(r?.used_recently ?? 0),
  };
}

/**
 * The account a token belongs to, for the audit row of a revocation.
 *
 * Returns `null` when there is no such user — the caller turns that into a
 * 404, so an admin cannot revoke a token of a user that does not exist.
 */
export async function getMcpTokenOwner(
  userId: number,
): Promise<{ userId: number; username: string } | null> {
  const [rows] = await getPool().query<RowDataPacket[]>(
    'SELECT id, username FROM users WHERE id = ? LIMIT 1',
    [userId],
  );
  const row = rows[0];
  if (!row) return null;
  return { userId: Number(row.id), username: String(row.username) };
}
