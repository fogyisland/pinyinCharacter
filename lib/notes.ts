import { getPool } from './db';

export interface NoteRow {
  id: number;
  authorUserId: number | null;
  authorName: string;
  authorEmail: string | null;
  content: string;
  createdAt: Date;
  deletedAt: Date | null;
}

const MAX_CONTENT_LEN = 1000;
const MAX_NAME_LEN = 64;
const IP_MINUTE_LIMIT = 1;
const EMAIL_HOUR_LIMIT = 5;

export interface ListNotesOpts {
  limit?: number;
  includeDeleted?: boolean;
}

export async function listActiveNotes(opts: ListNotesOpts = {}): Promise<NoteRow[]> {
  return listAllNotesForAdmin({ ...opts, includeDeleted: false });
}

export async function listAllNotesForAdmin(opts: ListNotesOpts = {}): Promise<NoteRow[]> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const where = opts.includeDeleted ? '' : 'WHERE deleted_at IS NULL';
  const [rows] = await getPool().query<any[]>(
    `SELECT id, author_user_id, author_name, author_email, content, created_at, deleted_at
     FROM notes ${where} ORDER BY created_at DESC LIMIT ?`,
    [limit]
  );
  return (rows as any[]).map((r) => ({
    id: Number(r.id),
    authorUserId: r.author_user_id,
    authorName: r.author_name,
    authorEmail: r.author_email,
    content: r.content,
    createdAt: r.created_at,
    deletedAt: r.deleted_at,
  }));
}

export interface InsertNoteArgs {
  authorUserId: number | null;
  authorName: string;
  authorEmail: string | null;
  content: string;
  ip: string | null;
  userAgent: string | null;
}

export async function insertNote(args: InsertNoteArgs): Promise<number> {
  const name = args.authorName.trim().slice(0, MAX_NAME_LEN);
  const content = args.content.trim().slice(0, MAX_CONTENT_LEN);
  const email = args.authorEmail ? args.authorEmail.trim().slice(0, 254) : null;
  const ip = args.ip ? args.ip.slice(0, 45) : null;
  const ua = args.userAgent ? args.userAgent.slice(0, 255) : null;
  const [res] = await getPool().query<any>(
    `INSERT INTO notes (author_user_id, author_name, author_email, content, ip, user_agent)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [args.authorUserId, name, email, content, ip, ua]
  );
  return Number(res.insertId);
}

export async function softDeleteNote(id: number, byUserId: number): Promise<boolean> {
  const [res] = await getPool().query<any>(
    `UPDATE notes SET deleted_at = NOW(), deleted_by = ?
     WHERE id = ? AND deleted_at IS NULL`,
    [byUserId, id]
  );
  return res.affectedRows > 0;
}

export type RateLimitVerdict =
  | { allow: true }
  | { allow: false; retryAfterSec: number; reason: string };

function truncateDate(d: Date): Date {
  // strip seconds/ms so windowStart buckets cleanly per minute/hour
  const t = new Date(d);
  t.setSeconds(0, 0);
  return t;
}

export interface RateLimitArgs { ip: string | null; email: string | null; }

export async function checkRateLimit(args: RateLimitArgs): Promise<RateLimitVerdict> {
  const now = new Date();
  const minuteStart = truncateDate(now);
  const hourStart = new Date(minuteStart);
  hourStart.setMinutes(0);

  const checks: Array<{
    scope: 'ip' | 'email';
    value: string;
    windowKind: 'minute' | 'hour';
    windowStart: Date;
    limit: number;
    label: string;
  }> = [];

  if (args.ip) {
    checks.push({
      scope: 'ip', value: args.ip,
      windowKind: 'minute', windowStart: minuteStart,
      limit: IP_MINUTE_LIMIT, label: '同一 IP 一分钟内',
    });
  }
  if (args.email) {
    checks.push({
      scope: 'email', value: args.email,
      windowKind: 'hour', windowStart: hourStart,
      limit: EMAIL_HOUR_LIMIT, label: '同一邮箱一小时内',
    });
  }
  if (checks.length === 0) return { allow: true }; // no identifiers — skip

  const pool = getPool();
  for (const c of checks) {
    const [rows] = await pool.query<any[]>(
      `SELECT post_count FROM notes_rate_limits
       WHERE scope = ? AND key_value = ? AND window_kind = ? AND window_start = ? LIMIT 1`,
      [c.scope, c.value, c.windowKind, c.windowStart]
    );
    const count = Number((rows as any[])[0]?.post_count ?? 0);
    if (count >= c.limit) {
      const nextWindow = c.windowKind === 'minute'
        ? new Date(minuteStart.getTime() + 60_000)
        : new Date(hourStart.getTime() + 3600_000);
      const retryAfterSec = Math.max(1, Math.ceil((nextWindow.getTime() - now.getTime()) / 1000));
      return {
        allow: false,
        retryAfterSec,
        reason: `${c.label}最多 ${c.limit} 条,请稍后再试`,
      };
    }
  }
  return { allow: true };
}

export async function bumpRateLimit(args: RateLimitArgs): Promise<void> {
  const now = new Date();
  const minuteStart = truncateDate(now);
  const hourStart = new Date(minuteStart);
  hourStart.setMinutes(0);
  const pool = getPool();

  const bumps: Array<{ scope: 'ip' | 'email'; value: string; windowKind: 'minute' | 'hour'; windowStart: Date; }> = [];
  if (args.ip) bumps.push({ scope: 'ip', value: args.ip, windowKind: 'minute', windowStart: minuteStart });
  if (args.email) bumps.push({ scope: 'email', value: args.email, windowKind: 'hour', windowStart: hourStart });

  for (const b of bumps) {
    await pool.query(
      `INSERT INTO notes_rate_limits (scope, key_value, window_kind, window_start, post_count)
       VALUES (?, ?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE
         window_start = VALUES(window_start),
         post_count   = IF(window_start = VALUES(window_start), post_count + 1, 1)`,
      [b.scope, b.value, b.windowKind, b.windowStart]
    );
  }
}