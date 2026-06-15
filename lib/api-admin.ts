import type { ApiResult } from './api-auth';
import type { User } from './store';

export interface AdminUserRow {
  id: number; username: string; isAdmin: boolean;
  createdAt: string | Date; historyCount: number; favoriteCount: number;
}
export interface ListUsersData { users: AdminUserRow[]; total: number; }

export interface AuditLogRow {
  id: number; user_id: number | null; event: string;
  metadata: any; ip: string | null; user_agent: string | null; created_at: string | Date;
}
export interface AuditLogData { rows: AuditLogRow[]; total: number; }

export interface SystemStats {
  users: number; admins: number; history: number; favorites: number; audit: number;
}

export interface UserDetailData {
  user: AdminUserRow;
  recentHistory: Array<{
    id: number; user_id: number; kind: 'text2pinyin' | 'pinyin2text';
    input: string; output: string | null; is_favorite: 0 | 1;
    char_count: number; created_at: string | Date;
  }>;
}

async function call<T>(path: string, init: RequestInit): Promise<ApiResult<T>> {
  const res = await fetch(path, { ...init, credentials: 'same-origin' });
  if (res.status === 204) return { ok: true, data: null as any };
  const j = await res.json();
  return j as ApiResult<T>;
}

export async function adminListUsers(opts: { limit?: number; offset?: number } = {}): Promise<ApiResult<ListUsersData>> {
  const sp = new URLSearchParams();
  if (opts.limit !== undefined) sp.set('limit', String(opts.limit));
  if (opts.offset !== undefined) sp.set('offset', String(opts.offset));
  const qs = sp.toString();
  return call(`/api/admin/users${qs ? '?' + qs : ''}`, { method: 'GET' });
}

export async function adminGetUser(id: number): Promise<ApiResult<UserDetailData>> {
  return call(`/api/admin/users/${id}`, { method: 'GET' });
}

export async function adminDeleteUser(id: number, confirmUsername: string): Promise<ApiResult<null>> {
  return call(`/api/admin/users/${id}`, {
    method: 'DELETE', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ confirmUsername }),
  });
}

export async function adminResetUserPassword(id: number): Promise<ApiResult<{ tempPassword: string }>> {
  return call(`/api/admin/users/${id}/reset-password`, { method: 'POST' });
}

export async function adminPromoteUser(id: number): Promise<ApiResult<{ id: number; isAdmin: true }>> {
  return call(`/api/admin/users/${id}/promote`, { method: 'POST' });
}

export async function adminDemoteUser(id: number): Promise<ApiResult<{ id: number; isAdmin: false }>> {
  return call(`/api/admin/users/${id}/demote`, { method: 'POST' });
}

export async function adminGetAudit(opts: {
  userId?: number; event?: string; from?: string; to?: string;
  limit?: number; offset?: number;
} = {}): Promise<ApiResult<AuditLogData>> {
  const sp = new URLSearchParams();
  if (opts.userId !== undefined) sp.set('userId', String(opts.userId));
  if (opts.event) sp.set('event', opts.event);
  if (opts.from) sp.set('from', opts.from);
  if (opts.to) sp.set('to', opts.to);
  if (opts.limit !== undefined) sp.set('limit', String(opts.limit));
  if (opts.offset !== undefined) sp.set('offset', String(opts.offset));
  const qs = sp.toString();
  return call(`/api/admin/audit${qs ? '?' + qs : ''}`, { method: 'GET' });
}

export async function adminGetStats(): Promise<ApiResult<SystemStats>> {
  return call('/api/admin/stats', { method: 'GET' });
}

// --- H7: user disable/enable -------------------------------------------

export async function disableUserRequest(id: number): Promise<ApiResult<{ id: number; disabled: true }>> {
  return call(`/api/admin/users/${id}/disable`, { method: 'POST' });
}

export async function enableUserRequest(id: number): Promise<ApiResult<{ id: number; disabled: false }>> {
  return call(`/api/admin/users/${id}/enable`, { method: 'POST' });
}

// --- H8: user activity feed --------------------------------------------

export interface UserActivityItem {
  id: string;
  source: 'audit' | 'download' | 'ai_call';
  event: string;
  userId: number;
  username: string | null;
  ip: string | null;
  createdAt: string;
  metadata: Record<string, unknown>;
}
export interface UserActivityData { items: UserActivityItem[]; }

export async function getUserActivityRequest(id: number, after?: string): Promise<ApiResult<UserActivityData>> {
  const qs = after ? `?after=${encodeURIComponent(after)}` : '';
  return call(`/api/admin/users/${id}/activity${qs}`, { method: 'GET' });
}

// --- H9: unified logs --------------------------------------------------

export interface AdminLogRow {
  id: string;
  source: 'audit' | 'download' | 'ai_call';
  event: string;
  userId: number;
  username: string | null;
  ip: string | null;
  createdAt: string;
  metadata: Record<string, unknown>;
}
export interface AdminLogListData { items: AdminLogRow[]; total: number; page: number; pageSize: number; }

export async function listAdminLogsRequest(params: {
  source?: string; type?: string; userId?: number; ip?: string;
  from?: string; to?: string; page?: number; pageSize?: number;
} = {}): Promise<ApiResult<AdminLogListData>> {
  const sp = new URLSearchParams();
  if (params.source) sp.set('source', params.source);
  if (params.type) sp.set('type', params.type);
  if (params.userId !== undefined) sp.set('userId', String(params.userId));
  if (params.ip) sp.set('ip', params.ip);
  if (params.from) sp.set('from', params.from);
  if (params.to) sp.set('to', params.to);
  if (params.page !== undefined) sp.set('page', String(params.page));
  if (params.pageSize !== undefined) sp.set('pageSize', String(params.pageSize));
  const qs = sp.toString();
  return call(`/api/admin/logs${qs ? '?' + qs : ''}`, { method: 'GET' });
}

// --- H10: downloads ----------------------------------------------------

export interface AdminDownloadRow {
  id: number;
  userId: number;
  username: string | null;
  sourceType: string;
  sourceId: string;
  format: string;
  status: string;
  durationMs: number | null;
  ip: string | null;
  createdAt: string;
}
export interface AdminDownloadListData { items: AdminDownloadRow[]; total: number; page: number; pageSize: number; }

export async function listAdminDownloadsRequest(params: {
  userId?: number; sourceType?: string;
  from?: string; to?: string; page?: number; pageSize?: number;
} = {}): Promise<ApiResult<AdminDownloadListData>> {
  const sp = new URLSearchParams();
  if (params.userId !== undefined) sp.set('userId', String(params.userId));
  if (params.sourceType) sp.set('sourceType', params.sourceType);
  if (params.from) sp.set('from', params.from);
  if (params.to) sp.set('to', params.to);
  if (params.page !== undefined) sp.set('page', String(params.page));
  if (params.pageSize !== undefined) sp.set('pageSize', String(params.pageSize));
  const qs = sp.toString();
  return call(`/api/admin/downloads${qs ? '?' + qs : ''}`, { method: 'GET' });
}

export async function getDownloadStatsRequest(days = 7): Promise<ApiResult<unknown>> {
  return call(`/api/admin/downloads/stats?days=${days}`, { method: 'GET' });
}

// --- H11: AI calls + config -------------------------------------------

export interface AdminAiCallRow {
  id: number;
  userId: number;
  username: string | null;
  feature: string;
  model: string | null;
  status: string;
  durationMs: number | null;
  error: string | null;
  createdAt: string;
}
export interface AdminAiCallListData { rows: AdminAiCallRow[]; total: number; page: number; pageSize: number; }

export async function listAiCallsRequest(params: {
  feature?: string; status?: string; userId?: number;
  from?: string; to?: string; page?: number; pageSize?: number;
} = {}): Promise<ApiResult<AdminAiCallListData>> {
  const sp = new URLSearchParams();
  if (params.feature) sp.set('feature', params.feature);
  if (params.status) sp.set('status', params.status);
  if (params.userId !== undefined) sp.set('userId', String(params.userId));
  if (params.from) sp.set('from', params.from);
  if (params.to) sp.set('to', params.to);
  if (params.page !== undefined) sp.set('page', String(params.page));
  if (params.pageSize !== undefined) sp.set('pageSize', String(params.pageSize));
  const qs = sp.toString();
  return call(`/api/admin/ai/calls${qs ? '?' + qs : ''}`, { method: 'GET' });
}

export async function getAiStatsRequest(days = 7): Promise<ApiResult<unknown>> {
  return call(`/api/admin/ai/stats?days=${days}`, { method: 'GET' });
}

export type AiConfigMap = Record<string, string>;

export async function getAiConfigRequest(): Promise<ApiResult<AiConfigMap>> {
  return call('/api/admin/ai/config', { method: 'GET' });
}

export async function updateAiConfigRequest(body: Record<string, string | number>): Promise<ApiResult<AiConfigMap>> {
  return call('/api/admin/ai/config', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function getTtsConfigRequest(): Promise<ApiResult<Record<string, string>>> {
  return call('/api/admin/config', { method: 'GET' });
}

export async function updateTtsConfigRequest(body: Record<string, string>): Promise<ApiResult<Record<string, string>>> {
  return call('/api/admin/config', {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
}
