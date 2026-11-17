import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const findValidResetRowMock = vi.fn();
const markResetUsedMock = vi.fn();
vi.mock('@/lib/password-reset', () => ({
  findValidResetRow: (...args: unknown[]) => findValidResetRowMock(...args),
  markResetUsed: (...args: unknown[]) => markResetUsedMock(...args),
}));

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({
  getPool: () => ({ query: queryMock }),
}));

const auditMock = vi.fn();
vi.mock('@/lib/audit', () => ({
  writeAudit: (...args: unknown[]) => auditMock(...args),
}));

vi.mock('@/lib/auth', () => ({
  hashPassword: vi.fn().mockResolvedValue('new-hash'),
  signSession: vi.fn().mockResolvedValue('token'),
  setSessionCookie: vi.fn().mockResolvedValue(undefined),
  validatePassword: (v: string) => (v.length >= 8 && v.length <= 72 ? null : 'bad password'),
}));

import { POST } from '@/app/api/auth/reset/route';
import { GET } from '@/app/api/auth/reset-info/route';

beforeEach(() => {
  vi.clearAllMocks();
  findValidResetRowMock.mockResolvedValue(null);
  queryMock.mockReset();
  auditMock.mockReset();
});

let ipCounter = 0;
function nextIp(): string {
  ipCounter += 1;
  return '192.0.2.' + ipCounter;
}

/** A token long enough to pass the length check. */
const TOKEN = 'a'.repeat(40);

function postReset(ip = nextIp()): NextRequest {
  return new NextRequest('http://localhost/api/auth/reset', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({ token: TOKEN, newPassword: 'supersecret' }),
  });
}

function getResetInfo(ip = nextIp()): NextRequest {
  return new NextRequest(`http://localhost/api/auth/reset-info?token=${TOKEN}`, {
    headers: { 'x-forwarded-for': ip },
  });
}

describe('POST /api/auth/reset — the attempt budget is bounded', () => {
  it('blocks the eleventh attempt from one IP', async () => {
    // The reset token is 32 random bytes, so guessing it is not the
    // threat; but this route WRITES the account's password, so it is
    // worth hammering and worth keeping the database busy.
    const ip = '198.51.100.10';
    let last: Response | null = null;
    for (let i = 0; i < 11; i++) {
      last = await POST(postReset(ip));
    }
    expect(last).not.toBeNull();
    expect(last!.status).toBe(429);
    const body = (await last!.json()) as { error: { code: string } };
    expect(body.error.code).toBe('rate_limited');
  });

  it('does not reach the database once the budget is reached', async () => {
    const ip = '198.51.100.11';
    for (let i = 0; i < 11; i++) {
      await POST(postReset(ip));
    }
    const calls = queryMock.mock.calls.length;
    await POST(postReset(ip));
    expect(queryMock.mock.calls.length).toBe(calls);
  });

  it('keeps separate budgets per IP', async () => {
    const first = '198.51.100.12';
    for (let i = 0; i < 11; i++) {
      await POST(postReset(first));
    }
    const res = await POST(postReset('198.51.100.13'));
    // Not rate limited — it answered on its own merits (an invalid
    // token), which is a 400 rather than a 429.
    expect(res.status).toBe(400);
  });
});

describe('GET /api/auth/reset-info — the lookup budget is bounded', () => {
  it('blocks the twenty-first lookup from one IP', async () => {
    // This route is unauthenticated and answers "is this token live, and
    // whose is it" — an oracle worth bounding.
    const ip = '198.51.100.20';
    let last: Response | null = null;
    for (let i = 0; i < 21; i++) {
      last = await GET(getResetInfo(ip));
    }
    expect(last).not.toBeNull();
    expect(last!.status).toBe(429);
    const body = (await last!.json()) as { error: { code: string } };
    expect(body.error.code).toBe('rate_limited');
  });

  it('does not look the token up once the budget is reached', async () => {
    const ip = '198.51.100.21';
    for (let i = 0; i < 21; i++) {
      await GET(getResetInfo(ip));
    }
    const calls = findValidResetRowMock.mock.calls.length;
    await GET(getResetInfo(ip));
    expect(findValidResetRowMock.mock.calls.length).toBe(calls);
  });

  it('keeps separate budgets per IP', async () => {
    const first = '198.51.100.22';
    for (let i = 0; i < 21; i++) {
      await GET(getResetInfo(first));
    }
    const res = await GET(getResetInfo('198.51.100.23'));
    expect(res.status).toBe(400);
  });
});
