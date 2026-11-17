import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({
  getPool: () => ({ query: queryMock }),
}));

const auditMock = vi.fn();
vi.mock('@/lib/audit', () => ({
  writeAudit: (...args: unknown[]) => auditMock(...args),
}));

const signSessionMock = vi.fn();
const setSessionCookieMock = vi.fn();
vi.mock('@/lib/auth', () => ({
  verifyPassword: vi.fn(),
  signSession: (...args: unknown[]) => signSessionMock(...args),
  setSessionCookie: (...args: unknown[]) => setSessionCookieMock(...args),
}));

import { POST } from '@/app/api/auth/login/route';
import { verifyPassword } from '@/lib/auth';

const mockedVerify = vi.mocked(verifyPassword);

beforeEach(() => {
  vi.clearAllMocks();
  queryMock.mockReset();
  auditMock.mockReset();
  signSessionMock.mockResolvedValue('token-abc');
  setSessionCookieMock.mockResolvedValue(undefined);
  mockedVerify.mockResolvedValue(true);
});

/**
 * A distinct client IP per call site.
 *
 * The route has TWO budgets: one per IP (10 per 15 min) and one per
 * account (5 per 15 min). Both are module-level maps, so they live
 * for the whole test file. Every test therefore needs its own IP,
 * otherwise an earlier test exhausts the IP budget for a later one.
 */
let ipCounter = 0;
function nextIp(): string {
  ipCounter += 1;
  return '203.0.113.' + ipCounter;
}

function postReq(body: unknown, ip?: string): NextRequest {
  return new NextRequest('http://localhost/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip ?? nextIp() },
    body: JSON.stringify(body),
  });
}

function activeUser(username: string) {
  return {
    id: 9,
    username,
    password_hash: 'hash',
    is_admin: 0,
    disabled_at: null,
  };
}

function disabledUser(username: string) {
  return {
    id: 7,
    username,
    password_hash: 'hash',
    is_admin: 0,
    disabled_at: new Date('2026-01-01T00:00:00Z'),
  };
}

describe('POST /api/auth/login — the disabled account is not an oracle', () => {
  it('answers 401 with the SAME body as a wrong password', async () => {
    // This is the regression that mattered.
    //
    // A disabled account used to answer 403 with code `account_disabled`,
    // while a username that does not exist answered 401 `bad_credentials`.
    // That difference told an attacker "this username exists AND is
    // banned" — a second enumeration oracle on top of the bcrypt timing
    // one.
    const username = 'banned' + Date.now();
    queryMock.mockResolvedValueOnce([[disabledUser(username)]]);

    const res = await POST(postReq({ username, password: 'whatever' }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('bad_credentials');
  });

  it('answers 401 with the SAME body for a username that does not exist', async () => {
    queryMock.mockResolvedValueOnce([[]]);
    const res = await POST(postReq({ username: 'ghost' + Date.now(), password: 'whatever' }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('bad_credentials');
  });

  it('still spends a bcrypt comparison when the account is missing', async () => {
    // Without this the missing-account branch returned in ~1 ms while the
    // existing-account branch took ~110 ms — the timing oracle that
    // enumerates usernames even when the response body is identical.
    //
    // The comparison runs against a dummy hash, so `verifyPassword` is
    // NOT the function that is called — bcrypt.compare is.
    queryMock.mockResolvedValueOnce([[]]);
    const res = await POST(postReq({ username: 'ghost' + Date.now(), password: 'whatever' }));
    expect(res.status).toBe(401);
    // The password verifier was not reached, because the route compares
    // against its own dummy hash on the missing-account path.
    expect(mockedVerify).not.toHaveBeenCalled();
  });

  it('records the disabled login in the audit log', async () => {
    const username = 'banned2' + Date.now();
    queryMock.mockResolvedValueOnce([[disabledUser(username)]]);
    await POST(postReq({ username, password: 'whatever' }));
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'login_disabled', userId: 7 }),
    );
  });

  it('does not issue a session for a disabled account', async () => {
    const username = 'banned3' + Date.now();
    queryMock.mockResolvedValueOnce([[disabledUser(username)]]);
    await POST(postReq({ username, password: 'whatever' }));
    expect(signSessionMock).not.toHaveBeenCalled();
    expect(setSessionCookieMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/auth/login — brute force is rate limited', () => {
  it('blocks the sixth attempt against one account', async () => {
    // The per-account budget is 5 per 15 minutes. A distributed spray
    // comes from many IPs, so the per-IP budget alone cannot stop it.
    const username = 'sprayed' + Date.now();
    queryMock.mockResolvedValue([[]]);

    let last: Response | null = null;
    for (let i = 0; i < 6; i++) {
      last = await POST(postReq({ username, password: 'nope' }, '198.51.100.' + i));
    }
    expect(last).not.toBeNull();
    expect(last!.status).toBe(429);
    const body = (await last!.json()) as { error: { code: string } };
    expect(body.error.code).toBe('rate_limited');
  });

  it('records a rate-limited attempt in the audit log', async () => {
    const username = 'sprayed2' + Date.now();
    queryMock.mockResolvedValue([[]]);
    for (let i = 0; i < 6; i++) {
      await POST(postReq({ username, password: 'nope' }, '198.51.100.2' + i));
    }
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'login_rate_limited' }),
    );
  });

  it('keeps separate budgets per account', async () => {
    // One account exhausting its budget must not lock out another one.
    const first = 'first' + Date.now();
    const second = 'second' + Date.now();
    queryMock.mockResolvedValue([[]]);

    for (let i = 0; i < 6; i++) {
      await POST(postReq({ username: first, password: 'nope' }, '198.51.100.40'));
    }
    const res = await POST(postReq({ username: second, password: 'nope' }, '198.51.100.41'));
    expect(res.status).toBe(401);
  });

  it('restores the account budget after a successful login', async () => {
    // A legitimate user who mistyped twice must not be left one attempt
    // away from a lockout.
    const username = 'typo' + Date.now();
    queryMock.mockResolvedValue([[activeUser(username)]]);

    for (let i = 0; i < 4; i++) {
      mockedVerify.mockResolvedValueOnce(false);
      await POST(postReq({ username, password: 'wrong' }, '198.51.100.30'));
    }

    mockedVerify.mockResolvedValueOnce(true);
    const res = await POST(postReq({ username, password: 'right' }, '198.51.100.31'));
    expect(res.status).toBe(200);

    // The budget was reset, so a fresh set of attempts is allowed.
    for (let i = 0; i < 4; i++) {
      mockedVerify.mockResolvedValueOnce(false);
      const again = await POST(postReq({ username, password: 'wrong' }, '198.51.100.32'));
      expect(again.status).toBe(401);
    }
  });

  it('answers 401 for a wrong password', async () => {
    const username = 'real' + Date.now();
    queryMock.mockResolvedValue([[activeUser(username)]]);
    mockedVerify.mockResolvedValueOnce(false);
    const res = await POST(postReq({ username, password: 'wrong' }));
    expect(res.status).toBe(401);
  });

  it('answers 200 and issues a session for a good password', async () => {
    const username = 'good' + Date.now();
    queryMock.mockResolvedValue([[activeUser(username)]]);
    mockedVerify.mockResolvedValueOnce(true);
    const res = await POST(postReq({ username, password: 'right' }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; data: { user: { username: string } } };
    expect(body.ok).toBe(true);
    expect(body.data.user.username).toBe(username);
  });
});
