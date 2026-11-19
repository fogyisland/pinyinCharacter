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

import { GET as DELIVERIES_GET } from '@/app/api/admin/wecom/deliveries/route';
import { POST as RETRY_POST } from '@/app/api/admin/wecom/retry/route';

const mockedAdmin = vi.fn();
vi.mock('@/lib/auth', () => ({
  requireAdmin: (...args: unknown[]) => mockedAdmin(...args),
}));

/** The error MySQL raises when the migration has not been run yet. */
function missingTableError(): Error {
  return Object.assign(new Error("Table 'pinyin.wecom_deliveries' doesn't exist"), {
    code: 'ER_NO_SUCH_TABLE',
    errno: 1146,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  queryMock.mockReset();
  auditMock.mockReset();
  mockedAdmin.mockReset();
  mockedAdmin.mockResolvedValue({
    ok: true,
    user: { id: 1, username: 'admin', isAdmin: true },
  });
});

describe('the delivery routes before the migration has been run', () => {
  it('says the migration is missing instead of "server error"', async () => {
    queryMock.mockRejectedValueOnce(missingTableError());

    const res = await DELIVERIES_GET(
      new NextRequest('http://localhost/api/admin/wecom/deliveries?limit=50'),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    // The admin has to be told WHAT to do, not that the server is unwell.
    expect(body.error.message).toMatch(/migration/i);
    expect(body.error.message).not.toBe('server error');
  });

  it('says the migration is missing on the retry route too', async () => {
    queryMock.mockRejectedValueOnce(missingTableError());

    const res = await RETRY_POST(
      new NextRequest('http://localhost/api/admin/wecom/retry', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: 42 }),
      }),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.message).toMatch(/migration/i);
    expect(body.error.message).not.toBe('server error');
  });
});
