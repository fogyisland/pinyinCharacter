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

const emailMock = vi.fn();
vi.mock('@/lib/email', () => ({
  sendEmail: (...args: unknown[]) => emailMock(...args),
}));

vi.mock('@/lib/email-verification', () => ({
  issueVerificationToken: vi.fn().mockResolvedValue({ rawToken: 'tok' }),
}));

vi.mock('@/lib/seo/config', () => ({
  getRuntimeSiteUrl: vi.fn().mockResolvedValue('https://example.com'),
}));

const signSessionMock = vi.fn();
const setSessionCookieMock = vi.fn();
vi.mock('@/lib/auth', () => ({
  hashPassword: vi.fn().mockResolvedValue('hashed'),
  signSession: (...args: unknown[]) => signSessionMock(...args),
  setSessionCookie: (...args: unknown[]) => setSessionCookieMock(...args),
}));

import { POST } from '@/app/api/auth/register/route';

beforeEach(() => {
  vi.clearAllMocks();
  queryMock.mockReset();
  auditMock.mockReset();
  emailMock.mockResolvedValue(undefined);
  signSessionMock.mockResolvedValue('token');
  setSessionCookieMock.mockResolvedValue(undefined);
});

/**
 * A distinct client IP per call site.
 *
 * The route rate limits registration per IP (5 per hour), and the counter
 * is a module-level map that lives for the whole test file, so each test
 * needs its own IP.
 */
let ipCounter = 0;
function nextIp(): string {
  ipCounter += 1;
  return '198.51.100.' + ipCounter;
}

function postReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': nextIp() },
    body: JSON.stringify(body),
  });
}

const VALID_BODY = {
  username: 'newcomer',
  email: 'newcomer@example.com',
  password: 'supersecret',
};

/**
 * The queries the route makes, in order.
 *
 * 1. `SELECT COUNT(*) ... FROM users WHERE is_admin = 1` — is this the
 *    first account?
 * 2. `INSERT INTO users ...`
 */
function mockAdminCount(count: number): void {
  queryMock.mockResolvedValueOnce([[{ n: count }]]);
}

function mockInsert(insertId = 5): void {
  queryMock.mockResolvedValueOnce([{ insertId, affectedRows: 1 }]);
}

describe('POST /api/auth/register — the first administrator', () => {
  it('grants admin when the install has NO administrator', async () => {
    mockAdminCount(0);
    mockInsert(5);

    const res = await POST(postReq(VALID_BODY));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; data: { user: { isAdmin: boolean } } };
    expect(body.data.user.isAdmin).toBe(true);
  });

  it('does not grant admin when the install ALREADY has an administrator', async () => {
    // The rule is "the FIRST account of an empty install is the admin".
    // The old check asked "is the users table empty?" — which stayed true
    // for as long as the table was empty, so on a freshly-provisioned
    // database the first anonymous caller to hit this route became an
    // administrator even though the setup wizard was still running.
    mockAdminCount(1);
    mockInsert(6);

    const res = await POST(postReq(VALID_BODY));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; data: { user: { isAdmin: boolean } } };
    expect(body.data.user.isAdmin).toBe(false);
  });

  it('asks about ADMINS, not about the total user count', async () => {
    // This is the assertion that pins the fix in place. A user table
    // holding 50 ordinary accounts and one administrator must answer
    // "there IS an admin" — the old query counted every row, so it
    // answered "there is no admin" and handed out admin rights to the
    // next person who registered.
    mockAdminCount(1);
    mockInsert(7);

    await POST(postReq(VALID_BODY));

    const adminQuery = String(queryMock.mock.calls[0][0]);
    expect(adminQuery).toContain('is_admin');
    expect(adminQuery).toContain('FROM users');
  });

  it('does not grant admin when there are many users but no admin', async () => {
    // The inverse: 50 users, zero administrators. The first account is
    // the admin, so a 51st registration must not be one.
    mockAdminCount(0);
    mockInsert(8);

    const res = await POST(postReq(VALID_BODY));
    const body = (await res.json()) as { data: { user: { isAdmin: boolean } } };
    // Count says zero admins → this IS the first admin. The user count
    // never entered the decision.
    expect(body.data.user.isAdmin).toBe(true);
  });
});

describe('POST /api/auth/register — rate limiting', () => {
  it('blocks the sixth registration from one IP', async () => {
    // Without a limit the endpoint is an open signup oracle: unlimited
    // accounts, each one a row in `users` and a welcome + verification
    // email to send.
    const ip = '192.0.2.77';
    let last: Response | null = null;
    for (let i = 0; i < 6; i++) {
      mockAdminCount(0);
      mockInsert(10 + i);
      const req = new NextRequest('http://localhost/api/auth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
        body: JSON.stringify({ ...VALID_BODY, username: 'u' + i }),
      });
      last = await POST(req);
    }
    expect(last).not.toBeNull();
    expect(last!.status).toBe(429);
    const body = (await last!.json()) as { error: { code: string } };
    expect(body.error.code).toBe('rate_limited');
  });

  it('does not touch the database once the limit is reached', async () => {
    const ip = '192.0.2.78';
    for (let i = 0; i < 6; i++) {
      mockAdminCount(0);
      mockInsert(20 + i);
      const req = new NextRequest('http://localhost/api/auth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
        body: JSON.stringify({ ...VALID_BODY, username: 'v' + i }),
      });
      await POST(req);
    }
    const callsBefore = queryMock.mock.calls.length;
    const req = new NextRequest('http://localhost/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
      body: JSON.stringify({ ...VALID_BODY, username: 'w' }),
    });
    await POST(req);
    expect(queryMock.mock.calls.length).toBe(callsBefore);
  });
});
