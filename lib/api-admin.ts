import type { ApiResult } from './api-auth';

export interface AdminUserRow {
  id: number;
  username: string;
  isAdmin: boolean;
  createdAt: string | Date;
  historyCount: number;
  favoriteCount: number;
}

async function call<T>(path: string, init: RequestInit): Promise<ApiResult<T>> {
  const res = await fetch(path, { ...init, credentials: 'same-origin' });
  // A 204 carries no body, so there is no data to read — the cast says
  // so without opening an `any` escape hatch for the rest of the file.
  if (res.status === 204) return { ok: true, data: null as unknown as T };
  const j = await res.json();
  return j as ApiResult<T>;
}

export async function adminDeleteUser(
  id: number,
  confirmUsername: string,
): Promise<ApiResult<null>> {
  return call(`/api/admin/users/${id}`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ confirmUsername }),
  });
}

export async function adminResetUserPassword(
  id: number,
): Promise<ApiResult<{ tempPassword: string }>> {
  return call(`/api/admin/users/${id}/reset-password`, { method: 'POST' });
}

export async function adminPromoteUser(
  id: number,
): Promise<ApiResult<{ id: number; isAdmin: true }>> {
  return call(`/api/admin/users/${id}/promote`, { method: 'POST' });
}

export async function adminDemoteUser(
  id: number,
): Promise<ApiResult<{ id: number; isAdmin: false }>> {
  return call(`/api/admin/users/${id}/demote`, { method: 'POST' });
}

export async function disableUserRequest(
  id: number,
): Promise<ApiResult<{ id: number; disabled: true }>> {
  return call(`/api/admin/users/${id}/disable`, { method: 'POST' });
}

export async function enableUserRequest(
  id: number,
): Promise<ApiResult<{ id: number; disabled: false }>> {
  return call(`/api/admin/users/${id}/enable`, { method: 'POST' });
}

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

export async function getUserActivityRequest(
  id: number,
  after?: string,
): Promise<ApiResult<{ items: UserActivityItem[] }>> {
  const qs = after ? `?after=${encodeURIComponent(after)}` : '';
  return call(`/api/admin/users/${id}/activity${qs}`, { method: 'GET' });
}

export async function updateAiConfigRequest(
  body: Record<string, string | number>,
): Promise<ApiResult<{ config: Record<string, string>; hasApiKey: boolean }>> {
  return call('/api/admin/ai/config', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function updateTtsConfigRequest(
  body: Record<string, string>,
): Promise<ApiResult<Record<string, string>>> {
  return call('/api/admin/config', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function grantAdminMembershipRequest(body: {
  userId: number;
  planKey: string;
  note?: string;
}): Promise<ApiResult<{ id: number; expiresAt: string }>> {
  return call('/api/admin/memberships', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function revokeAdminMembershipRequest(
  id: number,
  reason?: string,
): Promise<
  ApiResult<{
    id: number;
    userId: number;
    username: string | null;
    planKey: string;
    source: 'manual' | 'paypal';
    amount: string | null;
    currency: string | null;
    grantedAt: string;
    expiresAt: string;
    revokedAt: string | null;
    note: string | null;
    grantedBy: number | null;
  }>
> {
  return call(`/api/admin/memberships/${id}/revoke`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reason }),
  });
}

export interface AdminPlanRow {
  id: number;
  planKey: string;
  displayName: string;
  durationDays: number;
  amount: string;
  currency: string;
  enabled: boolean;
  displayOrder: number;
  features: string[];
}

export async function listAdminPlansRequest(): Promise<ApiResult<{ items: AdminPlanRow[]; total: number }>> {
  return call('/api/admin/memberships/plans', { method: 'GET' });
}

export async function updateAdminPlanRequest(
  id: number,
  body: {
    displayName?: string;
    durationDays?: number;
    amount?: string;
    enabled?: boolean;
    displayOrder?: number;
    features?: ('unlimited_history' | 'download_pdf' | 'ai_calls' | 'priority_tts')[];
  },
): Promise<ApiResult<{ plan: AdminPlanRow }>> {
  return call(`/api/admin/memberships/plans/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function seedAdminPlansRequest(): Promise<ApiResult<{ seeded: number }>> {
  return call('/api/admin/memberships/plans/seed', { method: 'POST' });
}

export async function getAdminPayPalConfigRequest(): Promise<
  ApiResult<{
    mode: 'sandbox' | 'live';
    hasClientId: boolean;
    hasSecret: boolean;
    hasWebhookId: boolean;
    webhookUrl: string;
  }>
> {
  return call('/api/admin/paypal/config', { method: 'GET' });
}

export async function updateAdminPayPalConfigRequest(body: {
  mode?: 'sandbox' | 'live';
  clientId?: string;
  clientSecret?: string;
  webhookId?: string;
}): Promise<ApiResult<{ mode: 'sandbox' | 'live'; changed: string[] }>> {
  return call('/api/admin/paypal/config', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function testPayPalConnectionRequest(): Promise<
  ApiResult<{ ok: true; message: string }>
> {
  return call('/api/admin/paypal/test-connection', { method: 'POST' });
}

export async function revokeAdminMcpTokenRequest(
  userId: number,
): Promise<ApiResult<{ userId: number; username: string; revokedAt: string | null }>> {
  return call(`/api/admin/mcp/tokens/${userId}/revoke`, { method: 'POST' });
}
