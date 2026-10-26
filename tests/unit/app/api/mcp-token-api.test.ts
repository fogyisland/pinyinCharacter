import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/auth', () => ({
  requireUser: vi.fn(),
}));

vi.mock('@/lib/mcp-token', () => ({
  getTokenStatus: vi.fn(),
  issueToken: vi.fn(),
  revokeToken: vi.fn(),
  resolveToken: vi.fn(),
}));

vi.mock('@/lib/mcp-endpoint', () => ({
  resolveMcpEndpoint: vi.fn(async () => 'https://ziyun.example/mcp'),
}));

vi.mock('@/lib/audit', () => ({
  logUserAction: vi.fn(async () => {}),
}));

import { GET, POST, DELETE } from '@/app/api/mcp/token/route';
import { requireUser } from '@/lib/auth';
import { getTokenStatus, issueToken, revokeToken } from '@/lib/mcp-token';
import { logUserAction } from '@/lib/audit';

/**
 * The per-user MCP token endpoint.
 *
 * The contract under test:
 *  - 401 is `unauthorized` and 403 is `forbidden` (the spec's codes, not
 *    the ones requireUser() carries);
 *  - every answer — 200, 401, 403, 503 and 500 — is `no-store`;
 *  - the raw token appears in the POST response and nowhere else;
 *  - a database failure is a 503, and a failed audit row is a 500 rather
 *    than a 503 (the token was already issued, and a 503 would push the
 *    user into retrying and rotating the token they just received).
 */

const REAL_TOKEN = 'mcp_0123456789abcdefghijklmnopqrstuvwxyzABCDEFG';
const CREATED_AT = '2026-10-26T08:00:00.000Z';

const requireUserMock = vi.mocked(requireUser);
const getTokenStatusMock = vi.mocked(getTokenStatus);
const issueTokenMock = vi.mocked(issueToken);
const revokeTokenMock = vi.mocked(revokeToken);
const logUserActionMock = vi.mocked(logUserAction);

/** The spec's placeholder — the literal that goes into the config template. */
const TOKEN_PLACEHOLDER = 'Bearer mcp_<the raw token>';

function makeReq(method = 'GET'): NextRequest {
  return new NextRequest('https://ziyun.example/api/mcp/token', { method });
}

function signedIn(): void {
  requireUserMock.mockResolvedValue({ ok: true, user: { id: 7, username: 'tester' } });
}

function unauthenticated(): void {
  requireUserMock.mockResolvedValue({
    ok: false,
    reason: 'unauthenticated',
    response: NextResponse.json({ ok: false }, { status: 401 }),
  });
}

function accountDisabled(): void {
  requireUserMock.mockResolvedValue({
    ok: false,
    reason: 'account_disabled',
    response: NextResponse.json({ ok: false }, { status: 403 }),
  });
}

function noStore(response: Response): void {
  expect(response.headers.get('cache-control')).toContain('no-store');
}

beforeEach(() => {
  vi.clearAllMocks();
  signedIn();
  getTokenStatusMock.mockResolvedValue({
    state: 'active',
    createdAt: CREATED_AT,
    lastUsedAt: null,
    revokedAt: null,
  });
  issueTokenMock.mockResolvedValue({ raw: REAL_TOKEN, createdAt: CREATED_AT, replaced: false });
  revokeTokenMock.mockResolvedValue({ revokedAt: CREATED_AT });
  logUserActionMock.mockResolvedValue(undefined);
});

describe('GET /api/mcp/token', () => {
  it('answers 401 with the spec code when nobody is signed in', async () => {
    unauthenticated();
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('unauthorized');
    noStore(res);
  });

  it('answers 403 with the spec code when the account is disabled', async () => {
    accountDisabled();
    const res = await GET(makeReq());
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('forbidden');
    noStore(res);
  });

  it('answers 200 with the status, the endpoint and the config', async () => {
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.status.state).toBe('active');
    expect(body.data.status.createdAt).toBe(CREATED_AT);
    expect(body.data.endpoint).toBe('https://ziyun.example/mcp');
    expect(body.data.config.mcpServers['ziyun-chinese'].url).toBe('https://ziyun.example/mcp');
    expect(body.data.config.mcpServers['ziyun-chinese'].type).toBe('http');
    noStore(res);
  });

  it('never returns the raw token', async () => {
    const res = await GET(makeReq());
    const body = await res.json();
    expect(body.data.token).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain(REAL_TOKEN);
  });

  it('puts the spec placeholder into the config template', async () => {
    const res = await GET(makeReq());
    const body = await res.json();
    expect(body.data.config.mcpServers['ziyun-chinese'].headers.Authorization).toBe(
      TOKEN_PLACEHOLDER,
    );
  });

  it('answers 503 when the database call fails', async () => {
    getTokenStatusMock.mockRejectedValue(new Error('db is down'));
    const res = await GET(makeReq());
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe('service_unavailable');
    noStore(res);
  });
});

describe('POST /api/mcp/token', () => {
  it('answers 200 with the raw token exactly once', async () => {
    const res = await POST(makeReq('POST'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.token).toBe(REAL_TOKEN);
    expect(body.data.token).toHaveLength(47);
    expect(body.data.createdAt).toBe(CREATED_AT);
    expect(body.data.endpoint).toBe('https://ziyun.example/mcp');
    noStore(res);
  });

  it('answers with exactly the four documented fields', async () => {
    const res = await POST(makeReq('POST'));
    const body = await res.json();
    expect(Object.keys(body.data).sort()).toEqual(['config', 'createdAt', 'endpoint', 'token']);
  });

  it('puts the real token into the config template', async () => {
    const res = await POST(makeReq('POST'));
    const body = await res.json();
    expect(body.data.config.mcpServers['ziyun-chinese'].headers.Authorization).toBe(
      `Bearer ${REAL_TOKEN}`,
    );
  });

  it('answers 401 with the spec code when nobody is signed in', async () => {
    unauthenticated();
    const res = await POST(makeReq('POST'));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('unauthorized');
    noStore(res);
  });

  it('answers 403 with the spec code when the account is disabled', async () => {
    accountDisabled();
    const res = await POST(makeReq('POST'));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe('forbidden');
    noStore(res);
  });

  it('records the issue in the audit log', async () => {
    await POST(makeReq('POST'));
    expect(logUserActionMock).toHaveBeenCalledOnce();
    const [, userId, event, metadata] = logUserActionMock.mock.calls[0]!;
    expect(userId).toBe(7);
    expect(event).toBe('mcp_token_created');
    expect((metadata as { username?: string }).username).toBe('tester');
    expect((metadata as { title?: string }).title).toBe('tester 的 MCP Token');
  });

  it('records a rotation differently from a first issue', async () => {
    issueTokenMock.mockResolvedValue({ raw: REAL_TOKEN, createdAt: CREATED_AT, replaced: true });
    await POST(makeReq('POST'));
    const [, , event] = logUserActionMock.mock.calls[0]!;
    expect(event).toBe('mcp_token_regenerated');
  });

  it('answers 503 when the database call fails', async () => {
    issueTokenMock.mockRejectedValue(new Error('db is down'));
    const res = await POST(makeReq('POST'));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe('service_unavailable');
    noStore(res);
  });

  it('answers 500 — not 503 — when the audit write fails', async () => {
    logUserActionMock.mockRejectedValue(new Error('audit table is gone'));
    const res = await POST(makeReq('POST'));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe('server');
    noStore(res);
  });
});

describe('DELETE /api/mcp/token', () => {
  it('answers 200 with the moment the token was revoked', async () => {
    const res = await DELETE(makeReq('DELETE'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.revokedAt).toBe(CREATED_AT);
    noStore(res);
  });

  it('records the revocation in the audit log', async () => {
    await DELETE(makeReq('DELETE'));
    expect(logUserActionMock).toHaveBeenCalledOnce();
    const [, userId, event, metadata] = logUserActionMock.mock.calls[0]!;
    expect(userId).toBe(7);
    expect(event).toBe('mcp_token_revoked');
    expect((metadata as { username?: string }).username).toBe('tester');
    expect((metadata as { title?: string }).title).toBe('tester 的 MCP Token');
  });

  it('is idempotent — the second revoke keeps the first timestamp', async () => {
    const first = await DELETE(makeReq('DELETE'));
    const second = await DELETE(makeReq('DELETE'));
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const firstBody = await first.json();
    const secondBody = await second.json();
    expect(secondBody.data.revokedAt).toBe(firstBody.data.revokedAt);
  });

  it('answers 200 with no timestamp for a user who never had a token', async () => {
    revokeTokenMock.mockResolvedValue({ revokedAt: null });
    const res = await DELETE(makeReq('DELETE'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.revokedAt).toBeNull();
    noStore(res);
  });

  it('answers 401 with the spec code when nobody is signed in', async () => {
    unauthenticated();
    const res = await DELETE(makeReq('DELETE'));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('unauthorized');
    noStore(res);
  });

  it('answers 403 with the spec code when the account is disabled', async () => {
    accountDisabled();
    const res = await DELETE(makeReq('DELETE'));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe('forbidden');
    noStore(res);
  });

  it('answers 503 when the database call fails', async () => {
    revokeTokenMock.mockRejectedValue(new Error('db is down'));
    const res = await DELETE(makeReq('DELETE'));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe('service_unavailable');
    noStore(res);
  });

  it('answers 500 — not 503 — when the audit write fails', async () => {
    logUserActionMock.mockRejectedValue(new Error('audit table is gone'));
    const res = await DELETE(makeReq('DELETE'));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe('server');
    noStore(res);
  });
});
