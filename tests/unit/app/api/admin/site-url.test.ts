import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

/**
 * GET/PATCH /api/admin/site-url
 *
 * The GET handler used to fall back to `getSiteUrl()`, which throws in
 * production when `NEXT_PUBLIC_SITE_URL` is unset — so the endpoint that
 * reports "what is the site URL right now" answered 500 instead of the
 * answer "nothing is configured yet".
 */

const requireAdminMock = vi.fn();
vi.mock('@/lib/auth', () => ({
  requireAdmin: () => requireAdminMock(),
}));

const getConfigMock = vi.fn();
const setConfigMock = vi.fn();
vi.mock('@/lib/config', () => ({
  getConfig: (key: string) => getConfigMock(key),
  setConfig: (key: string, value: string, byUserId: number | null) =>
    setConfigMock(key, value, byUserId),
}));

const writeAuditMock = vi.fn();
vi.mock('@/lib/audit', () => ({
  writeAudit: (entry: unknown) => writeAuditMock(entry),
}));

import { GET, PATCH } from '@/app/api/admin/site-url/route';

const ADMIN = { id: 7, username: 'admin', isAdmin: true };
const ENV_KEY = 'NEXT_PUBLIC_SITE_URL';

function getReq(): NextRequest {
  return new NextRequest('http://localhost/api/admin/site-url');
}

function patchReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/admin/site-url', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAdminMock.mockResolvedValue({ ok: true, user: ADMIN });
  getConfigMock.mockResolvedValue(null);
  setConfigMock.mockResolvedValue(undefined);
  writeAuditMock.mockResolvedValue(undefined);
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv(ENV_KEY, '');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('GET /api/admin/site-url', () => {
  it('answers with the app_config value when there is one', async () => {
    getConfigMock.mockResolvedValue('https://ziyun.pudafo.com');
    const res = await GET(getReq());
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      data: { url: 'https://ziyun.pudafo.com', source: 'app_config' },
    });
  });

  it('answers with the environment value when app_config has no row', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://from-env.example.com');
    const res = await GET(getReq());
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      data: { url: 'https://from-env.example.com', source: 'env' },
    });
  });

  it('answers "unset" instead of 500 when nothing is configured (regression)', async () => {
    const res = await GET(getReq());
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      data: { url: '', source: 'unset' },
    });
  });

  it('answers "unset" instead of 500 when the database is unreachable', async () => {
    getConfigMock.mockRejectedValue(new Error('DATABASE_URL is not set'));
    const res = await GET(getReq());
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      data: { url: '', source: 'unset' },
    });
  });

  it('rejects an unauthenticated caller', async () => {
    requireAdminMock.mockResolvedValue({
      ok: false,
      reason: 'unauthenticated',
      response: NextResponse.json({ ok: false }, { status: 401 }),
    });
    const res = await GET(getReq());
    expect(res.status).toBe(401);
  });
});

describe('PATCH /api/admin/site-url', () => {
  it('stores the URL and writes an audit entry', async () => {
    const res = await PATCH(patchReq({ url: 'https://ziyun.pudafo.com' }));
    expect(res.status).toBe(200);
    expect(setConfigMock).toHaveBeenCalledWith('site.url', 'https://ziyun.pudafo.com', 7);
    expect(writeAuditMock).toHaveBeenCalledWith({
      userId: 7,
      event: 'site_url_updated',
      metadata: { url: 'https://ziyun.pudafo.com' },
    });
  });

  it('rejects a URL that is not http(s)', async () => {
    const res = await PATCH(patchReq({ url: 'ftp://example.com' }));
    expect(res.status).toBe(400);
    expect(setConfigMock).not.toHaveBeenCalled();
  });

  it('stores the canonical form — the default port is dropped', async () => {
    // What is stored has to be what the screen shows back and what every
    // consumer reads. Storing the raw `:443` would leave the table and
    // the screen disagreeing.
    const res = await PATCH(patchReq({ url: 'https://ziyun.pudafo.com:443' }));
    expect(res.status).toBe(200);
    expect(setConfigMock).toHaveBeenCalledWith('site.url', 'https://ziyun.pudafo.com', 7);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      data: { url: 'https://ziyun.pudafo.com', source: 'app_config' },
    });
  });

  it('stores the canonical form — the trailing slash is dropped', async () => {
    const res = await PATCH(patchReq({ url: 'https://ziyun.pudafo.com/' }));
    expect(res.status).toBe(200);
    expect(setConfigMock).toHaveBeenCalledWith('site.url', 'https://ziyun.pudafo.com', 7);
  });

  it('keeps a non-default port', async () => {
    const res = await PATCH(patchReq({ url: 'https://ziyun.pudafo.com:8443' }));
    expect(res.status).toBe(200);
    expect(setConfigMock).toHaveBeenCalledWith('site.url', 'https://ziyun.pudafo.com:8443', 7);
  });

  it('audits the canonical form, not the raw input', async () => {
    await PATCH(patchReq({ url: 'https://ziyun.pudafo.com:443' }));
    expect(writeAuditMock).toHaveBeenCalledWith({
      userId: 7,
      event: 'site_url_updated',
      metadata: { url: 'https://ziyun.pudafo.com' },
    });
  });
});
