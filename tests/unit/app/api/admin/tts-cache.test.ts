/**
 * The TTS cache endpoint of the admin.
 *
 * The endpoint used to hand-roll its own administrator check: it read the
 * session token off the request and asked the payload for `isAdmin`. The
 * token carries the user id and the user name and nothing else — admin
 * rights live in the `users` table and are read on every request — so the
 * payload never had that field, the check never passed, and the route
 * answered 403 to everybody, administrator included.
 *
 * The endpoint is on the deployed branch, so the "TTS 音频缓存" card of
 * /admin/settings/audio has been showing an error since it landed.
 *
 * What is pinned here:
 *  - the route defers to the one guard the whole admin uses (`requireAdmin`,
 *    which reads the database) instead of reading rights off the token;
 *  - it hands the guard's own answer back untouched — 401 for a signed-out
 *    caller, 403 for one who is signed in but not an administrator;
 *  - a failure inside the cache layer becomes a structured 500 rather than
 *    an unhandled rejection.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

vi.mock('@/lib/auth', () => ({
  requireAdmin: vi.fn(),
}));

vi.mock('@/lib/tts-cache', () => ({
  getTtsCacheSize: vi.fn(async () => ({ count: 7, bytes: 12345 })),
  clearTtsCache: vi.fn(async () => {}),
}));

import { GET, DELETE } from '@/app/api/admin/tts-cache/route';
import { requireAdmin } from '@/lib/auth';
import { getTtsCacheSize, clearTtsCache } from '@/lib/tts-cache';

const requireAdminMock = vi.mocked(requireAdmin);
const sizeMock = vi.mocked(getTtsCacheSize);
const clearMock = vi.mocked(clearTtsCache);

/** The guard lets an administrator through. */
function allowAdmin(): void {
  requireAdminMock.mockResolvedValue({
    ok: true,
    user: { id: 1, username: 'admin', isAdmin: true },
  });
}

/** The guard refuses: signed out is a 401, signed in but not admin is a 403. */
function deny(reason: 'unauthenticated' | 'forbidden'): NextResponse {
  const response = NextResponse.json(
    { ok: false, error: { code: reason } },
    { status: reason === 'unauthenticated' ? 401 : 403 },
  );
  requireAdminMock.mockResolvedValue({ ok: false, reason, response });
  return response;
}

beforeEach(() => {
  vi.clearAllMocks();
  allowAdmin();
});

describe('the admin tts-cache route', () => {
  it('lets an administrator read the cache size', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, data: { count: 7, bytes: 12345 } });
  });

  it('asks the shared guard who the caller is', async () => {
    await GET();
    expect(requireAdminMock).toHaveBeenCalledTimes(1);
  });

  it('hands the guard\'s 401 back to a signed-out caller', async () => {
    deny('unauthenticated');
    const res = await GET();
    expect(res.status).toBe(401);
    expect(sizeMock).not.toHaveBeenCalled();
  });

  it('hands the guard\'s 403 back to a signed-in non-administrator', async () => {
    deny('forbidden');
    const res = await GET();
    expect(res.status).toBe(403);
    expect(sizeMock).not.toHaveBeenCalled();
  });

  it('clears the cache for an administrator', async () => {
    const res = await DELETE();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
    expect(clearMock).toHaveBeenCalledOnce();
  });

  it('refuses to clear the cache for a signed-out caller', async () => {
    deny('unauthenticated');
    const res = await DELETE();
    expect(res.status).toBe(401);
    expect(clearMock).not.toHaveBeenCalled();
  });

  it('turns a failing cache layer into a structured 500', async () => {
    sizeMock.mockRejectedValueOnce(new Error('cache table missing'));
    const res = await GET();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('server');
  });
});
