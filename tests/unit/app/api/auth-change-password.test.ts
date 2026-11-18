/**
 * A signed-in user must be able to change their own password.
 *
 * Until this route existed the only ways to change a password were:
 *   - the forgot-password email flow (needs access to the mailbox), and
 *   - an admin resetting it from the admin panel (needs admin rights).
 *
 * Neither works for a normal user who has simply forgotten their password
 * but still has the app open in front of them. The account is stuck until
 * somebody with admin rights intervenes.
 *
 * The contract this test pins:
 *   - the CURRENT password must be supplied and must verify, otherwise the
 *     endpoint is a free password reset for anyone who finds an open
 *     session on the machine;
 *   - the NEW password must pass the same validatePassword() the register
 *     and reset routes use;
 *   - the new hash must be written to the users table;
 *   - the change is audited;
 *   - the session cookie is cleared, so a stolen old session cannot keep
 *     using the account after the password changed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * mysql2's query() resolves to a [rows, fields] tuple. The route
 * destructures the rows out of it, so the mock has to return the same
 * shape — a bare array would throw "is not iterable" on the destructure.
 */
const queryMock = vi.fn();
const verifyPasswordMock = vi.fn();
const hashPasswordMock = vi.fn();
const clearSessionCookieMock = vi.fn();
const getCurrentUserMock = vi.fn();

vi.mock('@/lib/db', () => ({
  getPool: () => ({ query: queryMock }),
}));

// The route resolves the session through the cookie. next/headers needs a
// request scope, which a bare unit test does not have, so the cookie store
// is faked here.
const cookieStore = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) =>
        cookieStore.has(name) ? { name, value: cookieStore.get(name)! } : undefined,
      delete: (name: string) => cookieStore.delete(name),
    }),
}));

vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth');
  return {
    ...actual,
    getCurrentUser: (...args: unknown[]) => getCurrentUserMock(...args),
    verifyPassword: (...args: unknown[]) => verifyPasswordMock(...args),
    hashPassword: (...args: unknown[]) => hashPasswordMock(...args),
    clearSessionCookie: (...args: unknown[]) => clearSessionCookieMock(...args),
  };
});

const auditMock = vi.fn();
vi.mock('@/lib/audit', () => ({
  writeAudit: (...args: unknown[]) => auditMock(...args),
}));

import { POST } from '@/app/api/auth/change-password/route';

beforeEach(() => {
  vi.clearAllMocks();
  queryMock.mockReset();
  auditMock.mockReset();
  verifyPasswordMock.mockReset();
  hashPasswordMock.mockReset();
  clearSessionCookieMock.mockReset();
  verifyPasswordMock.mockResolvedValue(true);
  hashPasswordMock.mockResolvedValue('new-hash');
  clearSessionCookieMock.mockResolvedValue(undefined);
  getCurrentUserMock.mockResolvedValue({ id: 9, username: 'tester' });
  cookieStore.clear();
  // Default: an account with a stored hash, so a test that does not care
  // about the database still reaches the behaviour it is checking.
  queryMock.mockResolvedValue([[{ password_hash: 'old-hash' }], []]);
});

/** The route resolves the session through the cookie. */
function req(body: unknown, cookie = 'auth_token=session-abc'): NextRequest {
  return new NextRequest('http://localhost/api/auth/change-password', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(body),
  });
}

describe('POST /api/auth/change-password', () => {
  it('exists', () => {
    expect(typeof POST).toBe('function');
  });

  it('rejects a request with no session', async () => {
    // No session cookie ⇒ getCurrentUser() resolves to null.
    getCurrentUserMock.mockResolvedValue(null);
    const res = await POST(req({ currentPassword: 'old-pass-1', newPassword: 'new-pass-2' }, ''));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('unauthorized');
    // It must not touch the password column of anybody's account.
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('rejects a wrong current password without writing anything', async () => {
    verifyPasswordMock.mockResolvedValue(false);
    const res = await POST(req({ currentPassword: 'wrong-pass-1', newPassword: 'new-pass-2' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('wrong_password');
    // The whole point: a wrong current password must NOT update the hash.
    // (Reading the stored hash is required — that is what gets verified.)
    expect(
      queryMock.mock.calls.filter((c) => String(c[0]).includes('UPDATE users')),
      'the password must not be written when the current one is wrong',
    ).toHaveLength(0);
    expect(hashPasswordMock).not.toHaveBeenCalled();
  });

  it('rejects a new password that fails the shared validation', async () => {
    const res = await POST(req({ currentPassword: 'old-pass-1', newPassword: 'short' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('invalid_password');
    expect(hashPasswordMock).not.toHaveBeenCalled();
    expect(
      queryMock.mock.calls.filter((c) => String(c[0]).includes('UPDATE users')),
      'the password must not be written when the new one is invalid',
    ).toHaveLength(0);
  });

  it('rejects a new password longer than bcrypt can hash', async () => {
    const res = await POST(
      req({ currentPassword: 'old-pass-1', newPassword: 'x'.repeat(73) }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('invalid_password');
  });

  it('rejects a missing current password', async () => {
    const res = await POST(req({ newPassword: 'new-pass-2' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('missing_current_password');
    expect(
      queryMock.mock.calls.filter((c) => String(c[0]).includes('UPDATE users')),
      'the password must not be written without the current one',
    ).toHaveLength(0);
  });

  it('writes the new hash to the users table', async () => {
    queryMock.mockResolvedValue([[{ password_hash: 'old-hash' }], []]);
    const res = await POST(req({ currentPassword: 'old-pass-1', newPassword: 'new-pass-2' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    const updateCall = queryMock.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('UPDATE users SET password_hash'),
    );
    expect(updateCall, 'the new hash must be written to users').toBeTruthy();
    expect(updateCall![1]).toEqual(['new-hash', expect.any(Number)]);
  });

  it('verifies the current password against the stored hash', async () => {
    queryMock.mockResolvedValue([[{ password_hash: 'stored-hash' }], []]);
    await POST(req({ currentPassword: 'old-pass-1', newPassword: 'new-pass-2' }));
    expect(verifyPasswordMock).toHaveBeenCalledWith('old-pass-1', 'stored-hash');
  });

  it('audits the change', async () => {
    queryMock.mockResolvedValue([[{ password_hash: 'old-hash' }], []]);
    await POST(req({ currentPassword: 'old-pass-1', newPassword: 'new-pass-2' }));
    expect(auditMock).toHaveBeenCalled();
    const event = auditMock.mock.calls[0][0] as { event?: string; userId?: number };
    expect(event.event).toBe('password_changed');
  });

  it('clears the session cookie so the old session stops working', async () => {
    queryMock.mockResolvedValue([[{ password_hash: 'old-hash' }], []]);
    await POST(req({ currentPassword: 'old-pass-1', newPassword: 'new-pass-2' }));
    expect(clearSessionCookieMock).toHaveBeenCalled();
  });

  it('rejects a malformed JSON body without throwing', async () => {
    const bad = new NextRequest('http://localhost/api/auth/change-password', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: 'auth_token=session-abc' },
      body: 'not json',
    });
    const res = await POST(bad);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('bad_json');
  });
});
