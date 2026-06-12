import { getPool } from './db';

export type UnifiedLogSource = 'audit' | 'download' | 'ai_call';

export interface UnifiedLogEntry {
  id: string;
  source: UnifiedLogSource;
  event: string;
  userId: number | null;
  username: string | null;
  ip: string | null;
  createdAt: string;
  metadata: Record<string, unknown>;
}

export interface ListUnifiedLogsOptions {
  type?: string;        // event type filter
  userId?: number;
  ip?: string;
  from?: string;        // ISO date
  to?: string;
  page?: number;
  pageSize?: number;
}
export interface ListUnifiedLogsResult {
  items: UnifiedLogEntry[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listUnifiedLogs(opts: ListUnifiedLogsOptions = {}): Promise<ListUnifiedLogsResult> {
  const page = Math.max(opts.page ?? 1, 1);
  const pageSize = Math.min(Math.max(opts.pageSize ?? 50, 1), 100);
  const offset = (page - 1) * pageSize;

  const pool = getPool();

  // Audit
  const auditWhere: string[] = [];
  const auditParams: any[] = [];
  if (opts.type) { auditWhere.push(`a.event = ?`); auditParams.push(opts.type); }
  if (opts.userId) { auditWhere.push(`a.user_id = ?`); auditParams.push(opts.userId); }
  if (opts.ip) { auditWhere.push(`a.ip = ?`); auditParams.push(opts.ip); }
  if (opts.from) { auditWhere.push(`a.created_at >= ?`); auditParams.push(opts.from); }
  if (opts.to) { auditWhere.push(`a.created_at <= ?`); auditParams.push(opts.to); }
  const auditSql = auditWhere.length ? `WHERE ${auditWhere.join(' AND ')}` : '';

  // Downloads — include only when type filter is absent or matches
  const includeDownloads = !opts.type || opts.type === 'download_logged' || opts.type === 'download';
  const dlWhere: string[] = [];
  const dlParams: any[] = [];
  if (includeDownloads) {
    if (opts.userId) { dlWhere.push(`d.user_id = ?`); dlParams.push(opts.userId); }
    if (opts.from) { dlWhere.push(`d.created_at >= ?`); dlParams.push(opts.from); }
    if (opts.to) { dlWhere.push(`d.created_at <= ?`); dlParams.push(opts.to); }
  }
  const dlSql = includeDownloads && dlWhere.length ? `WHERE ${dlWhere.join(' AND ')}` : '';

  // AI calls
  const includeAi = !opts.type || opts.type === 'ai_call' || opts.type.startsWith('ai_');
  const aiWhere: string[] = [];
  const aiParams: any[] = [];
  if (includeAi) {
    if (opts.type && opts.type.startsWith('ai_')) {
      // ai_error -> status='error', ai_rate_limited -> status='rate-limited'
      const statusValue = opts.type.replace('ai_', '');
      aiWhere.push(`a.status = ?`);
      aiParams.push(statusValue);
    }
    if (opts.userId) { aiWhere.push(`a.user_id = ?`); aiParams.push(opts.userId); }
    if (opts.from) { aiWhere.push(`a.created_at >= ?`); aiParams.push(opts.from); }
    if (opts.to) { aiWhere.push(`a.created_at <= ?`); aiParams.push(opts.to); }
  }
  const aiSql = includeAi && aiWhere.length ? `WHERE ${aiWhere.join(' AND ')}` : '';

  // Fetch 200 from each, merge + sort + paginate in JS (acceptable at our scale)
  const [auditRows] = await pool.query<any[]>(
    `SELECT a.id, a.event, a.user_id, u.username, a.ip, a.metadata, a.created_at
     FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
     ${auditSql} ORDER BY a.created_at DESC LIMIT 200`,
    auditParams,
  );
  const dlRows = includeDownloads ? (await pool.query<any[]>(
    `SELECT d.id, d.user_id, u.username, d.source_type, d.source_id, d.status, d.format, d.duration_ms, d.created_at
     FROM downloads d LEFT JOIN users u ON u.id = d.user_id
     ${dlSql} ORDER BY d.created_at DESC LIMIT 200`,
    dlParams,
  ))[0] : [];
  const aiRows = includeAi ? (await pool.query<any[]>(
    `SELECT a.id, a.user_id, u.username, a.feature, a.model, a.status, a.duration_ms, a.error, a.metadata, a.created_at
     FROM ai_calls a LEFT JOIN users u ON u.id = a.user_id
     ${aiSql} ORDER BY a.created_at DESC LIMIT 200`,
    aiParams,
  ))[0] : [];

  const items: UnifiedLogEntry[] = [
    ...auditRows.map((r: any) => ({
      id: `audit:${r.id}`, source: 'audit' as const, event: r.event, userId: r.user_id,
      username: r.username, ip: r.ip, createdAt: toIso(r.created_at),
      metadata: typeof r.metadata === 'string' ? safeParse(r.metadata) : (r.metadata ?? {}),
    })),
    ...dlRows.map((r: any) => ({
      id: `download:${r.id}`, source: 'download' as const, event: 'download_logged', userId: r.user_id,
      username: r.username, ip: null, createdAt: toIso(r.created_at),
      metadata: { sourceType: r.source_type, sourceId: r.source_id, status: r.status, format: r.format, durationMs: r.duration_ms },
    })),
    ...aiRows.map((r: any) => ({
      id: `ai_call:${r.id}`, source: 'ai_call' as const, event: r.feature, userId: r.user_id,
      username: r.username, ip: null, createdAt: toIso(r.created_at),
      metadata: { model: r.model, status: r.status, durationMs: r.duration_ms, error: r.error, ...(typeof r.metadata === 'string' ? safeParse(r.metadata) : (r.metadata ?? {})) },
    })),
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return { items: items.slice(offset, offset + pageSize), total: items.length, page, pageSize };
}

function toIso(d: any): string {
  if (d instanceof Date) return d.toISOString();
  if (typeof d === 'string') return d;
  return String(d);
}
function safeParse(s: string): Record<string, unknown> {
  try { return JSON.parse(s); } catch { return {}; }
}