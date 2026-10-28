import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { getPool } from './db';
import { HistoryRow, type HistoryDbRow } from './history';
import { randomBytes } from 'node:crypto';
import type { AuditEvent } from './audit';

/** The value shapes mysql2 accepts as a bound SQL parameter. */
type SqlParam = string | number | bigint | boolean | Date | Buffer | null;

interface AdminUserListRow extends RowDataPacket {
  id: number;
  username: string;
  is_admin: number | boolean;
  created_at: Date;
  disabled_at: Date | null;
}

interface HistoryCountRow extends RowDataPacket {
  user_id: number;
  total: number;
  fav: number;
}

interface UserCountRow extends RowDataPacket {
  n: number;
}

interface UserBreakdownRow extends RowDataPacket {
  total: number;
  admins: number;
  disabled: number;
}

interface AdminUserDetailRow extends RowDataPacket {
  id: number;
  username: string;
  is_admin: number | boolean;
  created_at: Date;
  disabled_at: Date | null;
  historyCount: number;
  favoriteCount: number;
}

interface AuditLogDbRow extends RowDataPacket {
  id: number;
  user_id: number | null;
  event: string;
  metadata: Record<string, unknown> | null;
  ip: string | null;
  user_agent: string | null;
  created_at: Date;
}

interface SystemStatsRow extends RowDataPacket {
  users: number;
  admins: number;
  history: number;
  favorites: number;
  audit: number;
}

interface DisabledAtRow extends RowDataPacket {
  disabled_at: Date | null;
}

export interface AdminUserRow {
  id: number;
  username: string;
  isAdmin: boolean;
  createdAt: Date;
  disabledAt: Date | null;
  historyCount: number;
  favoriteCount: number;
}

export interface ListUsersOptions {
  limit?: number;
  offset?: number;
  q?: string;
  isAdmin?: boolean;
  disabled?: boolean;
}
export interface ListUsersResult {
  users: AdminUserRow[];
  total: number;
}

/** The WHERE clause shared by the user queries. */
function buildUserFilter(opts: ListUsersOptions): { whereSql: string; params: SqlParam[] } {
  const where: string[] = [];
  const params: SqlParam[] = [];
  if (opts.q) {
    // Match username OR email. Email is nullable; u.email LIKE ? returns
    // null which is falsy in WHERE so non-email users still match username.
    where.push(`(u.username LIKE ? OR u.email LIKE ?)`);
    params.push(`%${opts.q}%`, `%${opts.q}%`);
  }
  if (typeof opts.isAdmin === 'boolean') {
    where.push(`u.is_admin = ?`);
    params.push(opts.isAdmin ? 1 : 0);
  }
  if (typeof opts.disabled === 'boolean') {
    where.push(opts.disabled ? `u.disabled_at IS NOT NULL` : `u.disabled_at IS NULL`);
  }
  return { whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

/**
 * The history / favourite counters for one page of users.
 *
 * These used to come from a joined derived table:
 *
 *   LEFT JOIN (SELECT user_id, COUNT(*) AS total, ... FROM history
 *              GROUP BY user_id) h ON h.user_id = u.id
 *
 * MySQL materialises a derived table in full, and the page's WHERE clause
 * cannot be pushed into it — so every call scanned the ENTIRE `history`
 * table, no matter how few rows the page showed. EXPLAIN confirmed it:
 * the derived table showed up as `type=ref` over a `history` plan of
 * `type=index extra=Using index` (a full index scan).
 *
 * Restricting the aggregate to the ids of the current page turns that full
 * scan into one index range scan per row. `idx_user_fav (user_id,
 * is_favorite, created_at)` covers both counted columns, so the range scan
 * never even touches the table itself.
 */
async function aggregateHistoryCounts(
  userIds: number[],
): Promise<Map<number, { total: number; fav: number }>> {
  const counts = new Map<number, { total: number; fav: number }>();
  if (userIds.length === 0) return counts;
  const placeholders = userIds.map(() => '?').join(',');
  const [rows] = await getPool().query<HistoryCountRow[]>(
    `SELECT user_id,
            COUNT(*) AS total,
            SUM(CASE WHEN is_favorite = 1 THEN 1 ELSE 0 END) AS fav
     FROM history
     WHERE user_id IN (${placeholders})
     GROUP BY user_id`,
    userIds,
  );
  for (const r of rows) {
    counts.set(Number(r.user_id), { total: Number(r.total), fav: Number(r.fav) });
  }
  return counts;
}

export async function listUsers(opts: ListUsersOptions = {}): Promise<ListUsersResult> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  const pool = getPool();
  const { whereSql, params } = buildUserFilter(opts);

  // The page of users and its total are independent — run them together.
  const [userResult, countResult] = await Promise.all([
    pool.query<AdminUserListRow[]>(
      `SELECT u.id, u.username, u.is_admin, u.created_at, u.disabled_at
       FROM users u
       ${whereSql}
       ORDER BY u.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    ),
    pool.query<UserCountRow[]>(`SELECT COUNT(*) AS n FROM users u ${whereSql}`, params),
  ]);
  const userRows = userResult[0];
  const countRows = countResult[0];

  const counts = await aggregateHistoryCounts(userRows.map((r) => Number(r.id)));

  return {
    users: userRows.map((r) => {
      const id = Number(r.id);
      const counters = counts.get(id);
      return {
        id,
        username: r.username,
        isAdmin: r.is_admin === 1 || r.is_admin === true,
        createdAt: r.created_at,
        disabledAt: r.disabled_at,
        historyCount: counters?.total ?? 0,
        favoriteCount: counters?.fav ?? 0,
      };
    }),
    total: Number(countRows[0]?.n ?? 0),
  };
}

export interface UserCountBreakdown {
  /** Every user matching the search. */
  total: number;
  /** The administrators among them. */
  admins: number;
  /** The disabled ones among them. */
  disabled: number;
}

/**
 * The three chip counters on the user page, in a single query.
 *
 * The page used to call `listUsers({ limit: 1 })` twice just to read a
 * number off the result — and each of those calls still ran the full-table
 * history aggregate for its single row. Conditional aggregation produces
 * the same three numbers without touching `history` at all.
 */
export async function countUserBreakdown(q?: string): Promise<UserCountBreakdown> {
  const params: SqlParam[] = [];
  let whereSql = '';
  if (q) {
    whereSql = 'WHERE (u.username LIKE ? OR u.email LIKE ?)';
    params.push(`%${q}%`, `%${q}%`);
  }
  const [rows] = await getPool().query<UserBreakdownRow[]>(
    `SELECT
       COUNT(*) AS total,
       COALESCE(SUM(CASE WHEN u.is_admin = 1 THEN 1 ELSE 0 END), 0) AS admins,
       COALESCE(SUM(CASE WHEN u.disabled_at IS NOT NULL THEN 1 ELSE 0 END), 0) AS disabled
     FROM users u ${whereSql}`,
    params,
  );
  const r = rows[0];
  return {
    total: Number(r?.total ?? 0),
    admins: Number(r?.admins ?? 0),
    disabled: Number(r?.disabled ?? 0),
  };
}

export interface UserDetail {
  user: AdminUserRow;
  recentHistory: HistoryRow[];
}

export async function getUserDetail(id: number): Promise<UserDetail | null> {
  const pool = getPool();
  const [rows] = await pool.query<AdminUserDetailRow[]>(
    `SELECT u.id, u.username, u.is_admin, u.created_at, u.disabled_at,
            (SELECT COUNT(*) FROM history h WHERE h.user_id = u.id) AS historyCount,
            (SELECT COALESCE(SUM(CASE WHEN h.is_favorite = 1 THEN 1 ELSE 0 END), 0)
               FROM history h WHERE h.user_id = u.id) AS favoriteCount
     FROM users u
     WHERE u.id = ? LIMIT 1`,
    [id],
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  const user: AdminUserRow = {
    id: Number(r.id),
    username: r.username,
    isAdmin: Boolean(r.is_admin),
    createdAt: r.created_at,
    disabledAt: r.disabled_at,
    historyCount: Number(r.historyCount),
    favoriteCount: Number(r.favoriteCount),
  };
  const [hist] = await pool.query<HistoryDbRow[]>(
    `SELECT * FROM history WHERE user_id = ? ORDER BY created_at DESC LIMIT 10`,
    [id],
  );
  return { user, recentHistory: hist };
}

export interface AuditLogRow {
  id: number;
  user_id: number | null;
  event: string;
  metadata: Record<string, unknown> | null;
  ip: string | null;
  user_agent: string | null;
  created_at: Date;
}

export interface AuditLogOptions {
  userId?: number;
  event?: AuditEvent;
  from?: string; // ISO date
  to?: string; // ISO date
  limit?: number;
  offset?: number;
}
export interface AuditLogResult {
  rows: AuditLogRow[];
  total: number;
}

export async function getAuditLog(opts: AuditLogOptions = {}): Promise<AuditLogResult> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  const wheres: string[] = [];
  const params: SqlParam[] = [];
  if (opts.userId !== undefined) {
    wheres.push('user_id = ?');
    params.push(opts.userId);
  }
  if (opts.event) {
    wheres.push('event = ?');
    params.push(opts.event);
  }
  if (opts.from) {
    wheres.push('created_at >= ?');
    params.push(opts.from);
  }
  if (opts.to) {
    wheres.push('created_at <= ?');
    params.push(opts.to);
  }
  const where = wheres.length ? `WHERE ${wheres.join(' AND ')}` : '';
  const pool = getPool();
  const [rows] = await pool.query<AuditLogDbRow[]>(
    `SELECT id, user_id, event, metadata, ip, user_agent, created_at
     FROM audit_log ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  const [countRows] = await pool.query<UserCountRow[]>(
    `SELECT COUNT(*) AS n FROM audit_log ${where}`,
    params,
  );
  return { rows, total: Number(countRows[0]?.n ?? 0) };
}

export interface SystemStats {
  users: number;
  admins: number;
  history: number;
  favorites: number;
  audit: number;
}

export async function getSystemStats(): Promise<SystemStats> {
  const pool = getPool();
  const [rows] = await pool.query<SystemStatsRow[]>(
    `SELECT
       (SELECT COUNT(*) FROM users) AS users,
       (SELECT COUNT(*) FROM users WHERE is_admin = 1) AS admins,
       (SELECT COUNT(*) FROM history) AS history,
       (SELECT COUNT(*) FROM history WHERE is_favorite = 1) AS favorites,
       (SELECT COUNT(*) FROM audit_log) AS audit`,
  );
  const r = rows[0];
  return {
    users: Number(r?.users ?? 0),
    admins: Number(r?.admins ?? 0),
    history: Number(r?.history ?? 0),
    favorites: Number(r?.favorites ?? 0),
    audit: Number(r?.audit ?? 0),
  };
}

export async function countOtherAdmins(excludeUserId: number): Promise<number> {
  const pool = getPool();
  const [rows] = await pool.query<UserCountRow[]>(
    `SELECT COUNT(*) AS n FROM users WHERE is_admin = 1 AND id != ?`,
    [excludeUserId],
  );
  return Number(rows[0]?.n ?? 0);
}

export async function deleteUserCascade(id: number): Promise<boolean> {
  const pool = getPool();
  const [res] = await pool.query<ResultSetHeader>(`DELETE FROM users WHERE id = ?`, [id]);
  return res.affectedRows > 0;
}

export async function setUserAdmin(id: number, isAdmin: boolean): Promise<boolean> {
  const pool = getPool();
  const [res] = await pool.query<ResultSetHeader>(
    `UPDATE users SET is_admin = ? WHERE id = ?`,
    [isAdmin ? 1 : 0, id],
  );
  return res.affectedRows > 0;
}

export async function setUserPasswordHash(id: number, hash: string): Promise<boolean> {
  const pool = getPool();
  const [res] = await pool.query<ResultSetHeader>(
    `UPDATE users SET password_hash = ? WHERE id = ?`,
    [hash, id],
  );
  return res.affectedRows > 0;
}

export function generateTempPassword(): string {
  // 16 字节随机 → base64url ≈ 22 字符；bcrypt 限 72 字节，无压力
  return randomBytes(16).toString('base64url');
}

// (Plan H: disable / enable helpers + isUserDisabled guard)

export async function disableUser(id: number, _byAdminId: number): Promise<void> {
  const pool = getPool();
  await pool.query(`UPDATE users SET disabled_at = NOW() WHERE id = ? AND disabled_at IS NULL`, [
    id,
  ]);
}

export async function enableUser(id: number, _byAdminId: number): Promise<void> {
  const pool = getPool();
  await pool.query(`UPDATE users SET disabled_at = NULL WHERE id = ?`, [id]);
}

export async function isUserDisabled(userId: number): Promise<boolean> {
  const [rows] = await getPool().query<DisabledAtRow[]>(
    `SELECT disabled_at FROM users WHERE id = ? LIMIT 1`,
    [userId],
  );
  if (rows.length === 0) return false;
  return rows[0].disabled_at !== null;
}
