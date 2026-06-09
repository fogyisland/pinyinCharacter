import type { User } from './store';

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

async function call<T>(path: string, init: RequestInit): Promise<ApiResult<T>> {
  const res = await fetch(path, { ...init, credentials: 'same-origin' });
  const j = await res.json();
  return j as ApiResult<T>;
}

export async function registerRequest(username: string, password: string): Promise<ApiResult<{ user: User }>> {
  return call('/api/auth/register', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
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

export async function meRequest(): Promise<ApiResult<{ user: User }>> {
  return call('/api/auth/me', { method: 'GET' });
}