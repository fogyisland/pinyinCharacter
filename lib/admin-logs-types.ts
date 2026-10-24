/**
 * Types of the unified log query — client-safe (no mysql2).
 *
 * The implementation lives in lib/admin-logs.ts, which imports the database
 * pool. Client components must take the types from here, so the mysql2
 * bundle never reaches the browser.
 */

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
  /**
   * Restrict to a single source table. When omitted, all 3 tables are queried.
   * Accepted values: 'audit' | 'download' | 'ai_call'.
   */
  source?: UnifiedLogSource;
  /**
   * Plain event match: for `source='audit'` matches `audit_log.event`,
   * for `source='download'` matches the constant `download_logged`,
   * for `source='ai_call'` matches `ai_calls.feature`.
   */
  type?: string;
  userId?: number;
  ip?: string;
  from?: string;
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
