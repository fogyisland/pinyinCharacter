import { getPool } from './db';
import type { DownloadSourceType } from './downloads';

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
  const params: any[] = [];
  if (opts.userId) { where.push('d.user_id = ?'); params.push(opts.userId); }
  if (opts.sourceType) { where.push('d.source_type = ?'); params.push(opts.sourceType); }
  if (opts.from) { where.push('d.created_at >= ?'); params.push(opts.from); }
  if (opts.to) { where.push('d.created_at <= ?'); params.push(opts.to); }
  const sql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const pool = getPool();
  const [rows] = await pool.query<any[]>(
    `SELECT d.id, d.user_id, u.username, d.format, d.source_type, d.source_id, d.status, d.duration_ms, d.ip, d.user_agent, d.created_at
     FROM downloads d LEFT JOIN users u ON u.id = d.user_id
     ${sql} ORDER BY d.created_at DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, offset],
  );
  const [countRows] = await pool.query<any[]>(
    `SELECT COUNT(*) AS n FROM downloads d ${sql}`,
    params,
  );
  return {
    items: rows.map(r => ({
      id: Number(r.id), userId: Number(r.user_id), username: r.username,
      format: r.format, sourceType: r.source_type, sourceId: r.source_id,
      status: r.status, durationMs: r.duration_ms, ip: r.ip, userAgent: r.user_agent,
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    })),
    total: Number(countRows[0].n), page, pageSize,
  };
}

export interface DownloadStats {
  total: number;
  bySourceType: Record<DownloadSourceType, number>;
  topUsers: { userId: number; username: string | null; count: number }[];
}

export async function getDownloadStats(days = 7): Promise<DownloadStats> {
  const pool = getPool();
  const [totalRows] = await pool.query<any[]>(
    `SELECT COUNT(*) AS n FROM downloads WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)`,
    [days],
  );
  const [bySrc] = await pool.query<any[]>(
    `SELECT source_type, COUNT(*) AS n FROM downloads
     WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
     GROUP BY source_type`,
    [days],
  );
  const [topUsers] = await pool.query<any[]>(
    `SELECT d.user_id, u.username, COUNT(*) AS n
     FROM downloads d LEFT JOIN users u ON u.id = d.user_id
     WHERE d.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
     GROUP BY d.user_id, u.username
     ORDER BY n DESC LIMIT 5`,
    [days],
  );
  const bySourceType: any = { worksheet: 0, poem: 0, sutra: 0, 'rare-char-card': 0 };
  for (const r of bySrc) bySourceType[r.source_type] = Number(r.n);
  return {
    total: Number(totalRows[0].n),
    bySourceType,
    topUsers: topUsers.map((r: any) => ({ userId: Number(r.user_id), username: r.username, count: Number(r.n) })),
  };
}