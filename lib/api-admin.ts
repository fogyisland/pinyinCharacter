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
