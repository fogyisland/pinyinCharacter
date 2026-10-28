import type { RowDataPacket } from 'mysql2';
import { getPool } from './db';
import type { AiCallStatus } from './ai-calls';

/** The value shapes mysql2 accepts as a bound SQL parameter. */
type SqlParam = string | number | bigint | boolean | Date | Buffer | null;

interface AiCallListRow extends RowDataPacket {
  id: number;
  user_id: number | null;
  username: string | null;
  feature: string;
  model: string;
  status: AiCallStatus;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  duration_ms: number | null;
  error: string | null;
  metadata: Record<string, unknown> | string | null;
  created_at: Date | string;
}

interface AiCallCountRow extends RowDataPacket {
  n: number;
}

interface AiCallByDayRow extends RowDataPacket {
  d: Date | string;
  n: number;
}

interface AiCallErrorRateRow extends RowDataPacket {
  errs: number | null;
  total: number;
}

interface AiCallTopUserRow extends RowDataPacket {
  user_id: number;
  username: string | null;
  n: number;
}

interface AiCallDurationRow extends RowDataPacket {
  duration_ms: number;
}

export interface AiCallRow {
  id: number;
  userId: number | null;
  username: string | null;
  feature: string;
  model: string;
  status: AiCallStatus;
  promptTokens: number | null;
  completionTokens: number | null;
  durationMs: number | null;
  error: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface ListAiCallsOptions {
  feature?: string;
  status?: AiCallStatus;
  userId?: number;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}
export interface ListAiCallsResult {
  rows: AiCallRow[];
  total: number;
  page: number;
  pageSize: number;
}

function safeParse(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

export async function listAiCalls(opts: ListAiCallsOptions = {}): Promise<ListAiCallsResult> {
  const page = Math.max(opts.page ?? 1, 1);
  const pageSize = Math.min(Math.max(opts.pageSize ?? 50, 1), 200);
  const offset = (page - 1) * pageSize;
  const where: string[] = [];
  const params: SqlParam[] = [];
  if (opts.feature) {
    where.push('a.feature = ?');
    params.push(opts.feature);
  }
  if (opts.status) {
    where.push('a.status = ?');
    params.push(opts.status);
  }
  if (opts.userId) {
    where.push('a.user_id = ?');
    params.push(opts.userId);
  }
  if (opts.from) {
    where.push('a.created_at >= ?');
    params.push(opts.from);
  }
  if (opts.to) {
    where.push('a.created_at <= ?');
    params.push(opts.to);
  }
  const sql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const pool = getPool();
  const [rows] = await pool.query<AiCallListRow[]>(
    `SELECT a.id, a.user_id, u.username, a.feature, a.model, a.status,
            a.prompt_tokens, a.completion_tokens, a.duration_ms, a.error, a.metadata, a.created_at
     FROM ai_calls a LEFT JOIN users u ON u.id = a.user_id
     ${sql} ORDER BY a.created_at DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, offset],
  );
  const [countRows] = await pool.query<AiCallCountRow[]>(
    `SELECT COUNT(*) AS n FROM ai_calls a ${sql}`,
    params,
  );
  return {
    rows: rows.map((r) => ({
      id: Number(r.id),
      userId: r.user_id,
      username: r.username,
      feature: r.feature,
      model: r.model,
      status: r.status,
      promptTokens: r.prompt_tokens,
      completionTokens: r.completion_tokens,
      durationMs: r.duration_ms,
      error: r.error,
      metadata: typeof r.metadata === 'string' ? safeParse(r.metadata) : r.metadata,
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    })),
    total: Number(countRows[0].n),
    page,
    pageSize,
  };
}

export interface AiStats {
  total: number;
  byDay: { date: Date | string; count: number }[];
  errorRate: number; // 0..1
  p50Duration: number | null; // ms
  p95Duration: number | null; // ms
  topUsers: { userId: number; username: string | null; count: number }[];
}

export async function getAiStats(days = 7): Promise<AiStats> {
  const pool = getPool();
  // Run the independent stats queries in parallel — they're read-only against
  // the same window of ai_calls rows, no inter-dependencies. Each Promise.all
  // element is a [rows, fields] tuple from mysql2, so unwrap with [0].
  const results = await Promise.all([
    pool.query<AiCallCountRow[]>(
      `SELECT COUNT(*) AS n FROM ai_calls WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)`,
      [days],
    ),
    pool.query<AiCallByDayRow[]>(
      `SELECT DATE(created_at) AS d, COUNT(*) AS n FROM ai_calls
       WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
       GROUP BY DATE(created_at) ORDER BY d ASC`,
      [days],
    ),
    pool.query<AiCallErrorRateRow[]>(
      `SELECT
         SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errs,
         COUNT(*) AS total
       FROM ai_calls WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)`,
      [days],
    ),
    pool.query<AiCallTopUserRow[]>(
      `SELECT a.user_id, u.username, COUNT(*) AS n FROM ai_calls a
       LEFT JOIN users u ON u.id = a.user_id
       WHERE a.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY) AND a.user_id IS NOT NULL
       GROUP BY a.user_id, u.username ORDER BY n DESC LIMIT 5`,
      [days],
    ),
    pool.query<AiCallCountRow[]>(
      `SELECT COUNT(*) AS n FROM ai_calls
       WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY) AND duration_ms IS NOT NULL`,
      [days],
    ),
  ]);

  const totalRows = results[0][0];
  const byDay = results[1][0];
  const errRate = results[2][0];
  const topUsers = results[3][0];
  const durationCount = Number(results[4][0][0]?.n ?? 0);

  /**
   * The q-th percentile of the call durations.
   *
   * This used to pull EVERY duration in the window back to Node and pick the
   * percentile out of the array. MySQL 5.7 has no window functions, so the
   * percentile is fetched by counted offset instead: the row at the
   * percentile's index comes back and nothing else does. The value is
   * identical — same ordering, same index — but the transfer is one row
   * rather than one row per AI call in the window.
   */
  const percentile = async (q: number): Promise<number | null> => {
    if (durationCount === 0) return null;
    const idx = Math.min(durationCount - 1, Math.floor(q * durationCount));
    const [rows] = await pool.query<AiCallDurationRow[]>(
      `SELECT duration_ms FROM ai_calls
       WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY) AND duration_ms IS NOT NULL
       ORDER BY duration_ms ASC LIMIT 1 OFFSET ?`,
      [days, idx],
    );
    return rows.length ? Number(rows[0].duration_ms) : null;
  };
  const [p50, p95] = await Promise.all([percentile(0.5), percentile(0.95)]);

  const total = Number(errRate[0].total) || 0;
  return {
    total: Number(totalRows[0].n),
    byDay: byDay.map((r) => ({ date: r.d, count: Number(r.n) })),
    errorRate: total > 0 ? Number(errRate[0].errs) / total : 0,
    p50Duration: p50,
    p95Duration: p95,
    topUsers: topUsers.map((r) => ({
      userId: Number(r.user_id),
      username: r.username,
      count: Number(r.n),
    })),
  };
}
