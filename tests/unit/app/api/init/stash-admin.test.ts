import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/setup', () => ({
  isSetupRouteEnabled: vi.fn(),
}));

vi.mock('@/lib/init-credentials', () => ({
  stashAdminCredentials: vi.fn(() => 'a'.repeat(32)),
  // The TTL the route reports must be the TTL the store uses. The two
  // had drifted apart: the store keeps the token for 10 minutes while the
  // response said 120 seconds — a client counting down from that number
  // would expire the token five times too early.
  ADMIN_TOKEN_TTL_SEC: 600,
}));

import { POST } from '@/app/api/init/stash-admin/route';
import { isSetupRouteEnabled } from '@/lib/setup';
import { stashAdminCredentials, ADMIN_TOKEN_TTL_SEC } from '@/lib/init-credentials';

const mockedRouteEnabled = vi.mocked(isSetupRouteEnabled);
const mockedStash = vi.mocked(stashAdminCredentials);

beforeEach(() => {
  vi.clearAllMocks();
  mockedRouteEnabled.mockResolvedValue(true);
});

function postReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/init/stash-admin', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

describe('POST /api/init/stash-admin', () => {
  it('returns a token for valid credentials', async () => {
    mockedStash.mockReturnValueOnce('abc123def456abc123def456abc12345');
    const res = await POST(postReq({ username: 'admin', password: 'supersecret' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.token).toBe('abc123def456abc123def456abc12345');
    expect(body.data.expiresInSec).toBe(600);
    expect(mockedStash).toHaveBeenCalledWith({
      username: 'admin',
      password: 'supersecret',
      email: undefined,
    });
  });

  it('reports the TTL the store actually uses', async () => {
    mockedStash.mockReturnValueOnce('abc123def456abc123def456abc12345');
    const res = await POST(postReq({ username: 'admin', password: 'supersecret' }));
    const body = await res.json();
    // The number in the response and the constant the store uses are the
    // same source — a client can trust the countdown.
    expect(body.data.expiresInSec).toBe(ADMIN_TOKEN_TTL_SEC);
    expect(body.data.expiresInSec).toBe(600);
  });

  it('passes email when provided', async () => {
    await POST(postReq({ username: 'admin', password: 'supersecret', email: 'a@b.com' }));
    expect(mockedStash).toHaveBeenCalledWith({
      username: 'admin',
      password: 'supersecret',
      email: 'a@b.com',
    });
  });

  it('rejects short username', async () => {
    const res = await POST(postReq({ username: 'ab', password: 'supersecret' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('invalid_input');
    expect(mockedStash).not.toHaveBeenCalled();
  });

  it('rejects short password', async () => {
    const res = await POST(postReq({ username: 'admin', password: 'short' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('invalid_input');
  });

  it('rejects invalid username chars', async () => {
    const res = await POST(postReq({ username: 'ad min!', password: 'supersecret' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 setup_disabled when route is locked', async () => {
    mockedRouteEnabled.mockResolvedValueOnce(false);
    const res = await POST(postReq({ username: 'admin', password: 'supersecret' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('setup_disabled');
    expect(mockedStash).not.toHaveBeenCalled();
  });

  it('sets Cache-Control: no-store on the happy-path response', async () => {
    mockedStash.mockReturnValueOnce('abc123def456abc123def456abc12345');
    const res = await POST(postReq({ username: 'admin', password: 'supersecret' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});
