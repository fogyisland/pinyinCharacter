import { getPool } from './db';
import { HistoryRow } from './history';
import { randomBytes } from 'node:crypto';
import type { AuditEvent } from './audit';

export interface AdminUserRow {
  id: number;
  username: string;
  isAdmin: boolean;
  createdAt: Date;
  historyCount: number;
  favoriteCount: number;
}

export interface ListUsersOptions {
  limit?: number;
  offset?: number;
}
export interface ListUsersResult {
  users: AdminUserRow[];
  total: number;
}

export async function listUsers(opts: ListUsersOptions = {}): Promise<ListUsersResult> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  const pool = getPool();

  const [rows] = await pool.execute<any[]>(
    `SELECT u.id, u.username, u.is_admin, u.created_at,
            COALESCE(h.total, 0) AS historyCount,
            COALESCE(h.fav, 0) AS favoriteCount
     FROM users u
     LEFT JOIN (
       SELECT user_id,
              COUNT(*) AS total,
              SUM(CASE WHEN is_favorite = 1 THEN 1 ELSE 0 END) AS fav
       FROM history GROUP BY user_id
     ) h ON h.user_id = u.id
     ORDER BY u.created_at DESC
     LIMIT ? OFFSET ?`,
    [limit, offset]
  );
  const [countRows] = await pool.execute<any[]>(
    `SELECT COUNT(*) AS n FROM users`
  );

  return {
    users: rows.map(r => ({
      id: Number(r.id),
      username: r.username,
      isAdmin: Boolean(r.is_admin),
      createdAt: r.created_at,
      historyCount: Number(r.historyCount),
      favoriteCount: Number(r.favoriteCount),
    })),
    total: Number(countRows[0]?.n ?? 0),
  };
}

export interface UserDetail {
  user: AdminUserRow;
  recentHistory: HistoryRow[];
}

export async function getUserDetail(id: number): Promise<UserDetail | null> {
  const pool = getPool();
  const [rows] = await pool.execute<any[]>(
    `SELECT u.id, u.username, u.is_admin, u.created_at,
            COALESCE(h.total, 0) AS historyCount,
            COALESCE(h.fav, 0) AS favoriteCount
     FROM users u
     LEFT JOIN (
       SELECT user_id,
              COUNT(*) AS total,
              SUM(CASE WHEN is_favorite = 1 THEN 1 ELSE 0 END) AS fav
       FROM history GROUP BY user_id
     ) h ON h.user_id = u.id
     WHERE u.id = ? LIMIT 1`,
    [id]
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  const user: AdminUserRow = {
    id: Number(r.id),
    username: r.username,
    isAdmin: Boolean(r.is_admin),
    createdAt: r.created_at,
    historyCount: Number(r.historyCount),
    favoriteCount: Number(r.favoriteCount),
  };
  const [hist] = await pool.execute<any[]>(
    `SELECT * FROM history WHERE user_id = ? ORDER BY created_at DESC LIMIT 10`,
    [id]
  );
  return { user, recentHistory: hist as HistoryRow[] };
}

export interface AuditLogRow {
  id: number;
  user_id: number | null;
  event: string;
  metadata: any;
  ip: string | null;
  user_agent: string | null;
  created_at: Date;
}

export interface AuditLogOptions {
  userId?: number;
  event?: AuditEvent;
  from?: string;     // ISO date
  to?: string;       // ISO date
  limit?: number;
  offset?: number;
}
export interface AuditLogResult { rows: AuditLogRow[]; total: number; }

export async function getAuditLog(opts: AuditLogOptions = {}): Promise<AuditLogResult> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  const wheres: string[] = [];
  const params: any[] = [];
  if (opts.userId !== undefined) { wheres.push('user_id = ?'); params.push(opts.userId); }
  if (opts.event) { wheres.push('event = ?'); params.push(opts.event); }
  if (opts.from) { wheres.push('created_at >= ?'); params.push(opts.from); }
  if (opts.to) { wheres.push('created_at <= ?'); params.push(opts.to); }
  const where = wheres.length ? `WHERE ${wheres.join(' AND ')}` : '';
  const pool = getPool();
  const [rows] = await pool.execute<any[]>(
    `SELECT id, user_id, event, metadata, ip, user_agent, created_at
     FROM audit_log ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  const [countRows] = await pool.execute<any[]>(
    `SELECT COUNT(*) AS n FROM audit_log ${where}`,
    params
  );
  return { rows: rows as AuditLogRow[], total: Number(countRows[0]?.n ?? 0) };
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
  const [rows] = await pool.execute<any[]>(
    `SELECT
       (SELECT COUNT(*) FROM users) AS users,
       (SELECT COUNT(*) FROM users WHERE is_admin = 1) AS admins,
       (SELECT COUNT(*) FROM history) AS history,
       (SELECT COUNT(*) FROM history WHERE is_favorite = 1) AS favorites,
       (SELECT COUNT(*) FROM audit_log) AS audit`
  );
  const r = rows[0] ?? {};
  return {
    users: Number(r.users ?? 0),
    admins: Number(r.admins ?? 0),
    history: Number(r.history ?? 0),
    favorites: Number(r.favorites ?? 0),
    audit: Number(r.audit ?? 0),
  };
}

export async function countOtherAdmins(excludeUserId: number): Promise<number> {
  const pool = getPool();
  const [rows] = await pool.execute<any[]>(
    `SELECT COUNT(*) AS n FROM users WHERE is_admin = 1 AND id != ?`,
    [excludeUserId]
  );
  return Number(rows[0]?.n ?? 0);
}

export async function deleteUserCascade(id: number): Promise<boolean> {
  const pool = getPool();
  const [res] = await pool.execute<any>(
    `DELETE FROM users WHERE id = ?`,
    [id]
  );
  return res.affectedRows > 0;
}

export async function setUserAdmin(id: number, isAdmin: boolean): Promise<boolean> {
  const pool = getPool();
  const [res] = await pool.execute<any>(
    `UPDATE users SET is_admin = ? WHERE id = ?`,
    [isAdmin ? 1 : 0, id]
  );
  return res.affectedRows > 0;
}

export async function setUserPasswordHash(id: number, hash: string): Promise<boolean> {
  const pool = getPool();
  const [res] = await pool.execute<any>(
    `UPDATE users SET password_hash = ? WHERE id = ?`,
    [hash, id]
  );
  return res.affectedRows > 0;
}

export function generateTempPassword(): string {
  // 16 字节随机 → base64url ≈ 22 字符；bcrypt 限 72 字节，无压力
  return randomBytes(16).toString('base64url');
}
