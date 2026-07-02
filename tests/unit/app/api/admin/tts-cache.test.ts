import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const cookieStore = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve({
    get: (name: string) => cookieStore.has(name)
      ? { name, value: cookieStore.get(name)! }
      : undefined,
  }),
}));

vi.mock('@/lib/auth', () => ({
  verifySession: vi.fn(async (token: string) => {
    if (token === 'admin-token') return { userId: 1, isAdmin: true };
    if (token === 'user-token') return { userId: 2, isAdmin: false };
    return null;
  }),
  SESSION_COOKIE_NAME: 'pinyin_session',
}));

vi.mock('@/lib/tts-cache', () => ({
  getTtsCacheSize: vi.fn(async () => ({ count: 7, bytes: 12345 })),
  clearTtsCache: vi.fn(async () => {}),
}));

import { GET, DELETE } from '@/app/api/admin/tts-cache/route';

beforeEach(() => {
  cookieStore.clear();
  vi.clearAllMocks();
});

function makeReq(): NextRequest {
  const token = cookieStore.get('pinyin_session');
  const headers: Record<string, string> = {};
  if (token) headers['cookie'] = `pinyin_session=${token}`;
  return new NextRequest('http://localhost/api/admin/tts-cache', {
    method: 'GET',
    headers,
  });
}

describe('admin tts-cache route', () => {
  it('GET without session → 403', async () => {
    const res = await GET(makeReq());
    expect(res.status).toBe(403);
  });

  it('GET with non-admin session → 403', async () => {
    cookieStore.set('pinyin_session', 'user-token');
    const res = await GET(makeReq());
    expect(res.status).toBe(403);
  });

  it('GET with admin session → returns { count, bytes }', async () => {
    cookieStore.set('pinyin_session', 'admin-token');
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, data: { count: 7, bytes: 12345 } });
  });

  it('DELETE without session → 403', async () => {
    const res = await DELETE(makeReq());
    expect(res.status).toBe(403);
  });

  it('DELETE with admin session → clears cache + returns ok', async () => {
    cookieStore.set('pinyin_session', 'admin-token');
    const res = await DELETE(makeReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
    const ttsCache = await import('@/lib/tts-cache');
    expect(ttsCache.clearTtsCache).toHaveBeenCalledOnce();
  });
});
