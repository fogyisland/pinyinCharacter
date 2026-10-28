import type { RowDataPacket } from 'mysql2';
import { getPool } from './db';
import type { AiCallStatus } from './ai-calls';
import type { DownloadFormat, DownloadSourceType, DownloadStatus } from './downloads';
import type {
  ListUnifiedLogsOptions,
  ListUnifiedLogsResult,
  UnifiedLogEntry,
} from './admin-logs-types';

// The types live in their own file so a client component can import them
// without pulling the mysql2 bundle into the browser.
export type {
  ListUnifiedLogsOptions,
  ListUnifiedLogsResult,
  UnifiedLogEntry,
  UnifiedLogSource,
} from './admin-logs-types';

/** The value shapes mysql2 accepts as a bound SQL parameter. */
type SqlParam = string | number | bigint | boolean | Date | Buffer | null;

interface UnifiedCountRow extends RowDataPacket {
  n: number;
}

interface UnifiedAuditRow extends RowDataPacket {
  id: number;
  event: string;
  user_id: number | null;
  username: string | null;
  ip: string | null;
  metadata: Record<string, unknown> | string | null;
  created_at: Date | string;
}

interface UnifiedDownloadRow extends RowDataPacket {
  id: number;
  user_id: number;
  username: string | null;
  source_type: DownloadSourceType;
  source_id: string | null;
  status: DownloadStatus;
  format: DownloadFormat;
  duration_ms: number | null;
  created_at: Date | string;
}

interface UnifiedAiRow extends RowDataPacket {
  id: number;
  user_id: number | null;
  username: string | null;
  feature: string;
  model: string;
  status: AiCallStatus;
  duration_ms: number | null;
  error: string | null;
  metadata: Record<string, unknown> | string | null;
  created_at: Date | string;
}

/**
 * Unified logs across 3 sources (audit_log, downloads, ai_calls).
 *
 * Pagination strategy: each included table gets its own LIMIT/OFFSET and its
 * own COUNT(*). Totals are summed. Results from the 3 queries are merged and
 * sorted by createdAt desc, then sliced to `pageSize`.
 *
 * Trade-off: in the worst case each page fetches up to `3 * pageSize` rows
 * before slicing. This is acceptable at our scale (max ~pageSize=100). To get
 * truly exact page boundaries per source, we'd need a single UNION ALL with a
 * global LIMIT — that's a future optimization if needed.
 */
export async function listUnifiedLogs(
  opts: ListUnifiedLogsOptions = {},
): Promise<ListUnifiedLogsResult> {
  const page = Math.max(opts.page ?? 1, 1);
  const pageSize = Math.min(Math.max(opts.pageSize ?? 50, 1), 100);
  const offset = (page - 1) * pageSize;

  const pool = getPool();

  const includeAudit = !opts.source || opts.source === 'audit';
  const includeDownloads = !opts.source || opts.source === 'download';
  const includeAi = !opts.source || opts.source === 'ai_call';

  // --- Audit ---
  const auditWhere: string[] = [];
  const auditParams: SqlParam[] = [];
  if (includeAudit) {
    if (opts.type) {
      auditWhere.push(`a.event = ?`);
      auditParams.push(opts.type);
    }
    if (opts.userId) {
      auditWhere.push(`a.user_id = ?`);
      auditParams.push(opts.userId);
    }
    if (opts.ip) {
      auditWhere.push(`a.ip = ?`);
      auditParams.push(opts.ip);
    }
    if (opts.from) {
      auditWhere.push(`a.created_at >= ?`);
      auditParams.push(opts.from);
    }
    if (opts.to) {
      auditWhere.push(`a.created_at <= ?`);
      auditParams.push(opts.to);
    }
  }
  const auditSql = includeAudit && auditWhere.length ? `WHERE ${auditWhere.join(' AND ')}` : '';

  // --- Downloads ---
  // Download rows always have synthetic event 'download_logged'. When `type`
  // is set, downloads are matched only if type === 'download_logged' (the only
  // event value downloads can ever produce). Any other type yields zero rows.
  const dlWhere: string[] = [];
  const dlParams: SqlParam[] = [];
  if (includeDownloads) {
    if (opts.type && opts.type !== 'download_logged') {
      dlWhere.push('1 = 0');
    }
    if (opts.userId) {
      dlWhere.push(`d.user_id = ?`);
      dlParams.push(opts.userId);
    }
    if (opts.from) {
      dlWhere.push(`d.created_at >= ?`);
      dlParams.push(opts.from);
    }
    if (opts.to) {
      dlWhere.push(`d.created_at <= ?`);
      dlParams.push(opts.to);
    }
  }
  const dlSql = includeDownloads && dlWhere.length ? `WHERE ${dlWhere.join(' AND ')}` : '';

  // --- AI calls ---
  const aiWhere: string[] = [];
  const aiParams: SqlParam[] = [];
  if (includeAi) {
    if (opts.type) {
      aiWhere.push(`a.feature = ?`);
      aiParams.push(opts.type);
    }
    if (opts.userId) {
      aiWhere.push(`a.user_id = ?`);
      aiParams.push(opts.userId);
    }
    if (opts.from) {
      aiWhere.push(`a.created_at >= ?`);
      aiParams.push(opts.from);
    }
    if (opts.to) {
      aiWhere.push(`a.created_at <= ?`);
      aiParams.push(opts.to);
    }
  }
  const aiSql = includeAi && aiWhere.length ? `WHERE ${aiWhere.join(' AND ')}` : '';

  // Run paginated selects + accurate counts in parallel where possible.
  // Every promise is created eagerly, so all six are in flight before the
  // first await — same parallelism as collecting them in one array.
  const auditRowsPromise = includeAudit
    ? pool.query<UnifiedAuditRow[]>(
        `SELECT a.id, a.event, a.user_id, u.username, a.ip, a.metadata, a.created_at
         FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
         ${auditSql} ORDER BY a.created_at DESC, a.id DESC LIMIT ? OFFSET ?`,
        [...auditParams, pageSize, offset],
      )
    : null;
  const auditCountPromise = includeAudit
    ? pool.query<UnifiedCountRow[]>(`SELECT COUNT(*) AS n FROM audit_log a ${auditSql}`, auditParams)
    : null;
  const dlRowsPromise = includeDownloads
    ? pool.query<UnifiedDownloadRow[]>(
        `SELECT d.id, d.user_id, u.username, d.source_type, d.source_id, d.status, d.format, d.duration_ms, d.created_at
         FROM downloads d LEFT JOIN users u ON u.id = d.user_id
         ${dlSql} ORDER BY d.created_at DESC, d.id DESC LIMIT ? OFFSET ?`,
        [...dlParams, pageSize, offset],
      )
    : null;
  const dlCountPromise = includeDownloads
    ? pool.query<UnifiedCountRow[]>(`SELECT COUNT(*) AS n FROM downloads d ${dlSql}`, dlParams)
    : null;
  const aiRowsPromise = includeAi
    ? pool.query<UnifiedAiRow[]>(
        `SELECT a.id, a.user_id, u.username, a.feature, a.model, a.status, a.duration_ms, a.error, a.metadata, a.created_at
         FROM ai_calls a LEFT JOIN users u ON u.id = a.user_id
         ${aiSql} ORDER BY a.created_at DESC, a.id DESC LIMIT ? OFFSET ?`,
        [...aiParams, pageSize, offset],
      )
    : null;
  const aiCountPromise = includeAi
    ? pool.query<UnifiedCountRow[]>(`SELECT COUNT(*) AS n FROM ai_calls a ${aiSql}`, aiParams)
    : null;

  const [auditRowsResult, auditCountResult, dlRowsResult, dlCountResult, aiRowsResult, aiCountResult] =
    await Promise.all([
      auditRowsPromise,
      auditCountPromise,
      dlRowsPromise,
      dlCountPromise,
      aiRowsPromise,
      aiCountPromise,
    ]);

  // Walk the results in source order, taking rows then counts alternately.
  const auditRows = auditRowsResult ? auditRowsResult[0] : [];
  const auditCount = auditCountResult ? Number(auditCountResult[0][0].n) : 0;
  const dlRows = dlRowsResult ? dlRowsResult[0] : [];
  const dlCount = dlCountResult ? Number(dlCountResult[0][0].n) : 0;
  const aiRows = aiRowsResult ? aiRowsResult[0] : [];
  const aiCount = aiCountResult ? Number(aiCountResult[0][0].n) : 0;

  const total = auditCount + dlCount + aiCount;

  const items: UnifiedLogEntry[] = [
    ...auditRows.map((r) => ({
      id: `audit:${r.id}`,
      source: 'audit' as const,
      event: r.event,
      userId: r.user_id,
      username: r.username,
      ip: r.ip,
      createdAt: toIso(r.created_at),
      metadata: typeof r.metadata === 'string' ? safeParse(r.metadata) : (r.metadata ?? {}),
    })),
    ...dlRows.map((r) => ({
      id: `download:${r.id}`,
      source: 'download' as const,
      event: 'download_logged',
      userId: r.user_id,
      username: r.username,
      ip: null,
      createdAt: toIso(r.created_at),
      metadata: {
        sourceType: r.source_type,
        sourceId: r.source_id,
        status: r.status,
        format: r.format,
        durationMs: r.duration_ms,
      },
    })),
    ...aiRows.map((r) => ({
      id: `ai_call:${r.id}`,
      source: 'ai_call' as const,
      event: r.feature,
      userId: r.user_id,
      username: r.username,
      ip: null,
      createdAt: toIso(r.created_at),
      metadata: {
        model: r.model,
        status: r.status,
        durationMs: r.duration_ms,
        error: r.error,
        ...(typeof r.metadata === 'string' ? safeParse(r.metadata) : (r.metadata ?? {})),
      },
    })),
  ].sort((a, b) => {
    const dt = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    if (dt !== 0) return dt;
    // Stable tiebreak so pagination is deterministic when timestamps collide.
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  // Slice to pageSize. Could be > pageSize only when multiple sources are
  // merged (each source contributed up to pageSize); the sort + slice gives
  // a best-effort global page. See trade-off note in the doc comment above.
  return { items: items.slice(0, pageSize), total, page, pageSize };
}

function toIso(d: Date | string): string {
  if (d instanceof Date) return d.toISOString();
  if (typeof d === 'string') return d;
  return String(d);
}
function safeParse(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
