import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/auth', () => ({
  requireAdmin: vi.fn(),
}));

vi.mock('@/lib/mcp-token-admin', () => ({
  getAdminMcpTokenStats: vi.fn(),
  listAdminMcpTokens: vi.fn(),
  getMcpTokenOwner: vi.fn(),
}));

vi.mock('@/lib/mcp-token', () => ({
  revokeToken: vi.fn(),
}));

vi.mock('@/lib/audit', () => ({
  writeAudit: vi.fn(async () => {}),
}));

import { GET } from '@/app/api/admin/mcp/tokens/route';
import { POST } from '@/app/api/admin/mcp/tokens/[userId]/revoke/route';
import { requireAdmin } from '@/lib/auth';
import {
  getAdminMcpTokenStats,
  listAdminMcpTokens,
  getMcpTokenOwner,
} from '@/lib/mcp-token-admin';
import { revokeToken } from '@/lib/mcp-token';
import { writeAudit } from '@/lib/audit';

/**
 * The admin's MCP token routes.
 *
 * Two routes: the list of every token holder, and the revocation of one
 * of them. The contract under test:
 *  - both routes are administrator-only;
 *  - the list honours the `state` filter and falls back to `all` for a
 *    filter it does not know;
 *  - a revocation of an unknown user is a 404, not a silent success;
 *  - the revocation is written to the audit log with the target's name.
 */

const CREATED_AT = '2026-10-26T08:00:00.000Z';
const REVOKED_AT = '2026-10-27T09:00:00.000Z';

const requireAdminMock = vi.mocked(requireAdmin);
const statsMock = vi.mocked(getAdminMcpTokenStats);
const listMock = vi.mocked(listAdminMcpTokens);
const ownerMock = vi.mocked(getMcpTokenOwner);
const revokeMock = vi.mocked(revokeToken);
const auditMock = vi.mocked(writeAudit);

const TOKEN_ITEM = {
  userId: 7,
  username: 'tester',
  isAdmin: false,
  disabled: false,
  state: 'active' as const,
  createdAt: CREATED_AT,
  lastUsedAt: null,
  revokedAt: null,
};

function listRequest(query = ''): NextRequest {
  return new NextRequest(`https://ziyun.example/api/admin/mcp/tokens${query}`);
}

function revokeRequest(userId: string): NextRequest {
  return new NextRequest(`https://ziyun.example/api/admin/mcp/tokens/${userId}/revoke`, {
    method: 'POST',
  });
}

function asAdmin(): void {
  requireAdminMock.mockResolvedValue({
    ok: true,
    user: { id: 1, username: 'admin', isAdmin: true },
  });
}

function asNotAdmin(): void {
  requireAdminMock.mockResolvedValue({
    ok: false,
    reason: 'forbidden',
    response: NextResponse.json({ ok: false, error: { code: 'forbidden' } }, { status: 403 }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  asAdmin();
  statsMock.mockResolvedValue({
    totalUsers: 12,
    // The three token buckets partition the holders: 2 + 1 + 1 = 4.
    holders: 4,
    active: 2,
    disabled: 1,
    revoked: 1,
    usedRecently: 1,
  });
  listMock.mockResolvedValue({ items: [TOKEN_ITEM], total: 1 });
  ownerMock.mockResolvedValue({ userId: 7, username: 'tester' });
  revokeMock.mockResolvedValue({ revokedAt: REVOKED_AT });
  auditMock.mockResolvedValue(undefined);
});

describe('GET /api/admin/mcp/tokens', () => {
  it('answers 403 when the caller is not an administrator', async () => {
    asNotAdmin();
    const res = await GET(listRequest());
    expect(res.status).toBe(403);
    expect(statsMock).not.toHaveBeenCalled();
  });

  it('answers 200 with the counters and the list', async () => {
    const res = await GET(listRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.stats.holders).toBe(4);
    expect(body.data.stats.active).toBe(2);
    expect(body.data.stats.disabled).toBe(1);
    expect(body.data.items).toHaveLength(1);
    expect(body.data.items[0].username).toBe('tester');
    expect(body.data.total).toBe(1);
  });

  it('never carries the raw token', async () => {
    const res = await GET(listRequest());
    const raw = await res.text();
    expect(raw).not.toContain('mcp_');
  });

  it('filters by state', async () => {
    await GET(listRequest('?state=revoked'));
    expect(listMock).toHaveBeenCalledWith(expect.objectContaining({ state: 'revoked' }));
  });

  it('filters by the disabled accounts', async () => {
    await GET(listRequest('?state=disabled'));
    expect(listMock).toHaveBeenCalledWith(expect.objectContaining({ state: 'disabled' }));
  });

  it('falls back to "all" for a filter it does not know', async () => {
    await GET(listRequest('?state=whatever'));
    expect(listMock).toHaveBeenCalledWith(expect.objectContaining({ state: 'all' }));
  });

  it('passes the search term through', async () => {
    await GET(listRequest('?q=test'));
    expect(listMock).toHaveBeenCalledWith(expect.objectContaining({ q: 'test' }));
  });

  it('counts the tokens the search selects', async () => {
    // The counters and the list describe the same set — otherwise a chip
    // would count the whole table while the list below it showed the
    // search.
    await GET(listRequest('?q=alice'));
    expect(statsMock).toHaveBeenCalledWith('alice');
  });

  it('falls back to the default page size for a fractional limit', async () => {
    // MySQL's LIMIT takes whole numbers — a fractional one would be a
    // syntax error there and would come back as a 500.
    await GET(listRequest('?limit=1.5'));
    expect(listMock).toHaveBeenCalledWith(expect.objectContaining({ limit: undefined }));
  });

  it('falls back to the first page for a fractional offset', async () => {
    await GET(listRequest('?offset=2.5'));
    expect(listMock).toHaveBeenCalledWith(expect.objectContaining({ offset: 0 }));
  });

  it('accepts a whole page size', async () => {
    await GET(listRequest('?limit=20&offset=40'));
    expect(listMock).toHaveBeenCalledWith(expect.objectContaining({ limit: 20, offset: 40 }));
  });
});

describe('POST /api/admin/mcp/tokens/[userId]/revoke', () => {
  it('answers 403 when the caller is not an administrator', async () => {
    asNotAdmin();
    const res = await POST(revokeRequest('7'), { params: Promise.resolve({ userId: '7' }) });
    expect(res.status).toBe(403);
    expect(revokeMock).not.toHaveBeenCalled();
  });

  it('answers 400 for a user id that is not a number', async () => {
    const res = await POST(revokeRequest('abc'), { params: Promise.resolve({ userId: 'abc' }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('bad_id');
  });

  it('answers 400 for a user id that is not positive', async () => {
    const res = await POST(revokeRequest('0'), { params: Promise.resolve({ userId: '0' }) });
    expect(res.status).toBe(400);
  });

  it('answers 400 for a user id that is not a plain decimal number', async () => {
    // `Number()` would read these as 16, 1000 and 7 — three different
    // users than the digits in the path name.
    for (const raw of ['0x10', '1e3', ' 7 ', '7.0', '-7', 'abc']) {
      const res = await POST(revokeRequest(raw), { params: Promise.resolve({ userId: raw }) });
      expect(res.status, `${raw} should not be a user id`).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe('bad_id');
    }
    expect(revokeMock).not.toHaveBeenCalled();
  });

  it('answers 404 for a user who does not exist', async () => {
    ownerMock.mockResolvedValue(null);
    const res = await POST(revokeRequest('7'), { params: Promise.resolve({ userId: '7' }) });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('user_not_found');
    expect(revokeMock).not.toHaveBeenCalled();
  });

  it('answers 200 with the moment the token was revoked', async () => {
    const res = await POST(revokeRequest('7'), { params: Promise.resolve({ userId: '7' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.userId).toBe(7);
    expect(body.data.username).toBe('tester');
    expect(body.data.revokedAt).toBe(REVOKED_AT);
  });

  it('records the revocation in the audit log with the target name', async () => {
    await POST(revokeRequest('7'), { params: Promise.resolve({ userId: '7' }) });
    expect(auditMock).toHaveBeenCalledOnce();
    const [entry] = auditMock.mock.calls[0]!;
    expect(entry.userId).toBe(1);
    expect(entry.event).toBe('admin_mcp_token_revoked');
    expect((entry.metadata as { username?: string }).username).toBe('tester');
    expect((entry.metadata as { title?: string }).title).toBe('tester 的 MCP Token');
  });

  it('answers 200 with no timestamp for a user who never had a token', async () => {
    revokeMock.mockResolvedValue({ revokedAt: null });
    const res = await POST(revokeRequest('7'), { params: Promise.resolve({ userId: '7' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.revokedAt).toBeNull();
  });

  it('still answers 200 when the audit row cannot be written', async () => {
    // The token is already revoked at that point — a 500 would tell the
    // operator that the revocation did not happen, which is a lie.
    auditMock.mockRejectedValue(new Error('the audit table is gone'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await POST(revokeRequest('7'), { params: Promise.resolve({ userId: '7' }) });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.data.userId).toBe(7);
      expect(revokeMock).toHaveBeenCalledWith(7);
      expect(consoleError).toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });
});
