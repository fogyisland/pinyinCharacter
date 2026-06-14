import type { User } from './store';

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

async function call<T>(path: string, init: RequestInit): Promise<ApiResult<T>> {
  const res = await fetch(path, { ...init, credentials: 'same-origin' });
  if (res.status === 204) return { ok: true, data: null as any };
  const j = await res.json();
  return j as ApiResult<T>;
}

export async function registerRequest(
  username: string,
  email: string,
  password: string,
): Promise<ApiResult<{ user: User }>> {
  return call('/api/auth/register', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, email, password }),
  });
}

export async function loginRequest(username: string, password: string): Promise<ApiResult<{ user: User }>> {
  return call('/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
}

export async function logoutRequest(): Promise<ApiResult<null>> {
  return call<null>('/api/auth/logout', { method: 'POST' });
}

export async function meRequest(): Promise<ApiResult<{ user: User | null }>> {
  return call('/api/auth/me', { method: 'GET' });
}

export async function forgotPasswordRequest(username: string): Promise<ApiResult<null>> {
  return call<null>('/api/auth/forgot', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username }),
  });
}

export async function getResetInfoRequest(token: string): Promise<ApiResult<{ username: string }>> {
  return call(`/api/auth/reset-info?token=${encodeURIComponent(token)}`, { method: 'GET' });
}

export async function resetPasswordRequest(token: string, newPassword: string): Promise<ApiResult<{ user: User }>> {
  return call('/api/auth/reset', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token, newPassword }),
  });
}