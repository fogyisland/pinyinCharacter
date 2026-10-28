import type { RowDataPacket } from 'mysql2';
import { getPool } from './db';
import type { DownloadFormat, DownloadSourceType, DownloadStatus } from './downloads';

/** The value shapes mysql2 accepts as a bound SQL parameter. */
type SqlParam = string | number | bigint | boolean | Date | Buffer | null;

interface DownloadListRow extends RowDataPacket {
  id: number;
  user_id: number;
  username: string | null;
  format: DownloadFormat;
  source_type: DownloadSourceType;
  source_id: string | null;
  status: DownloadStatus;
  duration_ms: number | null;
  ip: string | null;
  user_agent: string | null;
  created_at: Date | string;
}

interface DownloadCountRow extends RowDataPacket {
  n: number;
}

interface DownloadSourceCountRow extends RowDataPacket {
  source_type: DownloadSourceType;
  n: number;
}

interface DownloadTopUserRow extends RowDataPacket {
  user_id: number;
  username: string | null;
  n: number;
}

export interface DownloadRow {
  id: number;
  userId: number;
  username: string | null;
  format: 'pdf' | 'print';
  sourceType: DownloadSourceType;
  sourceId: string | null;
  status: 'ok' | 'error';
  durationMs: number | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
}

export interface ListDownloadsOptions {
  userId?: number;
  sourceType?: DownloadSourceType;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}
export interface ListDownloadsResult {
  items: DownloadRow[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listDownloads(opts: ListDownloadsOptions = {}): Promise<ListDownloadsResult> {
  const page = Math.max(opts.page ?? 1, 1);
  const pageSize = Math.min(Math.max(opts.pageSize ?? 50, 1), 200);
  const offset = (page - 1) * pageSize;
  const where: string[] = [];
  const params: SqlParam[] = [];
  if (opts.userId) {
    where.push('d.user_id = ?');
    params.push(opts.userId);
  }
  if (opts.sourceType) {
    where.push('d.source_type = ?');
    params.push(opts.sourceType);
  }
  if (opts.from) {
    where.push('d.created_at >= ?');
    params.push(opts.from);
  }
  if (opts.to) {
    where.push('d.created_at <= ?');
    params.push(opts.to);
  }
  const sql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const pool = getPool();
  const [rows] = await pool.query<DownloadListRow[]>(
    `SELECT d.id, d.user_id, u.username, d.format, d.source_type, d.source_id, d.status, d.duration_ms, d.ip, d.user_agent, d.created_at
     FROM downloads d LEFT JOIN users u ON u.id = d.user_id
     ${sql} ORDER BY d.created_at DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, offset],
  );
  const [countRows] = await pool.query<DownloadCountRow[]>(
    `SELECT COUNT(*) AS n FROM downloads d ${sql}`,
    params,
  );
  return {
    items: rows.map((r) => ({
      id: Number(r.id),
      userId: Number(r.user_id),
      username: r.username,
      format: r.format,
      sourceType: r.source_type,
      sourceId: r.source_id,
      status: r.status,
      durationMs: r.duration_ms,
      ip: r.ip,
      userAgent: r.user_agent,
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    })),
    total: Number(countRows[0].n),
    page,
    pageSize,
  };
}

export interface DownloadStats {
  total: number;
  bySourceType: Record<DownloadSourceType, number>;
  topUsers: { userId: number; username: string | null; count: number }[];
}

export async function getDownloadStats(days = 7): Promise<DownloadStats> {
  const pool = getPool();
  // The three aggregates read the same window of rows and do not depend on
  // each other — one round trip instead of three.
  const [totalResult, bySrcResult, topUsersResult] = await Promise.all([
    pool.query<DownloadCountRow[]>(
      `SELECT COUNT(*) AS n FROM downloads WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)`,
      [days],
    ),
    pool.query<DownloadSourceCountRow[]>(
      `SELECT source_type, COUNT(*) AS n FROM downloads
       WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
       GROUP BY source_type`,
      [days],
    ),
    pool.query<DownloadTopUserRow[]>(
      `SELECT d.user_id, u.username, COUNT(*) AS n
       FROM downloads d LEFT JOIN users u ON u.id = d.user_id
       WHERE d.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
       GROUP BY d.user_id, u.username
       ORDER BY n DESC LIMIT 5`,
      [days],
    ),
  ]);
  const totalRows = totalResult[0];
  const bySrc = bySrcResult[0];
  const topUsers = topUsersResult[0];
  const bySourceType: Record<DownloadSourceType, number> = {
    worksheet: 0,
    poem: 0,
    sutra: 0,
    'rare-char-card': 0,
  };
  for (const r of bySrc) bySourceType[r.source_type] = Number(r.n);
  return {
    total: Number(totalRows[0].n),
    bySourceType,
    topUsers: topUsers.map((r) => ({
      userId: Number(r.user_id),
      username: r.username,
      count: Number(r.n),
    })),
  };
}
