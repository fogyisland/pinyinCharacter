import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/setup', () => ({
  isSetupRouteEnabled: vi.fn(),
}));

vi.mock('@/lib/init-credentials', () => ({
  consumeAdminCredentials: vi.fn(),
}));

const createAdminUserMock = vi.fn();
vi.mock('@/scripts/init-db', () => ({
  createAdminUser: (...args: any[]) => createAdminUserMock(...args),
}));

import { POST } from '@/app/api/init/create-admin/route';
import { isSetupRouteEnabled } from '@/lib/setup';
import { consumeAdminCredentials } from '@/lib/init-credentials';

const mockedRouteEnabled = vi.mocked(isSetupRouteEnabled);
const mockedConsume = vi.mocked(consumeAdminCredentials);

beforeEach(() => {
  vi.clearAllMocks();
  process.env.DATABASE_URL = 'mysql://test:test@localhost/test';
  mockedRouteEnabled.mockResolvedValue(true);
  createAdminUserMock.mockResolvedValue({ userId: 42, username: 'admin' });
});

function postReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/init/create-admin', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

describe('POST /api/init/create-admin (token-based)', () => {
  it('consumes token and creates user', async () => {
    mockedConsume.mockReturnValueOnce({ username: 'admin', password: 'supersecret', email: 'a@b.com' });
    const res = await POST(postReq({ token: 'a'.repeat(32) }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.userId).toBe(42);
    expect(mockedConsume).toHaveBeenCalledWith('a'.repeat(32));
    expect(createAdminUserMock).toHaveBeenCalledWith({
      username: 'admin',
      password: 'supersecret',
      email: 'a@b.com',
    });
    // Secret-bearing endpoint — must never be HTTP-cached
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('returns 400 invalid_input when token missing', async () => {
    const res = await POST(postReq({}));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('invalid_input');
    expect(mockedConsume).not.toHaveBeenCalled();
  });

  it('returns 400 invalid_input when token wrong length', async () => {
    const res = await POST(postReq({ token: 'short' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('invalid_input');
  });

  it('returns 401 token_expired when consume returns null', async () => {
    mockedConsume.mockReturnValueOnce(null);
    const res = await POST(postReq({ token: 'a'.repeat(32) }));
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('token_expired');
    expect(createAdminUserMock).not.toHaveBeenCalled();
  });

  it('returns 400 setup_disabled when route locked', async () => {
    mockedRouteEnabled.mockResolvedValueOnce(false);
    const res = await POST(postReq({ token: 'a'.repeat(32) }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('setup_disabled');
    expect(mockedConsume).not.toHaveBeenCalled();
  });
});
