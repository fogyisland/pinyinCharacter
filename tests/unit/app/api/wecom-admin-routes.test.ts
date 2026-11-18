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

// One mock function per operation. Do NOT collapse them into a single
// `vi.fn()` keyed by a string argument — the module factory runs before the
// test body, so a keyed dispatcher would have to be configured before it
// exists, and every test would have to re-key it.
const listWebhooksMock = vi.fn();
const createWebhookMock = vi.fn();
const updateWebhookMock = vi.fn();
const deleteWebhookMock = vi.fn();
vi.mock('@/lib/wecom-webhooks', () => ({
  listWebhooks: (...args: unknown[]) => listWebhooksMock(...args),
  createWebhook: (...args: unknown[]) => createWebhookMock(...args),
  updateWebhook: (...args: unknown[]) => updateWebhookMock(...args),
  deleteWebhook: (...args: unknown[]) => deleteWebhookMock(...args),
  // The route checks `error instanceof WecomDuplicateNameError`. A mock
  // that does not export it makes the route throw a TypeError instead of
  // answering — the mock must carry the same shape as the real module.
  WecomDuplicateNameError: class WecomDuplicateNameError extends Error {
    code = 'duplicate_name' as const;
  },
}));

const enqueueMock = vi.fn();
vi.mock('@/lib/wecom-deliver', () => ({
  enqueueWecomNotification: (...args: unknown[]) => enqueueMock(...args),
  pushWecomDelivery: vi.fn(),
}));

import { GET, POST, PUT, DELETE } from '@/app/api/admin/wecom/webhooks/route';
import { POST as RETRY_POST } from '@/app/api/admin/wecom/retry/route';

const mockedAdmin = vi.fn();
vi.mock('@/lib/auth', () => ({
  requireAdmin: (...args: unknown[]) => mockedAdmin(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
  queryMock.mockReset();
  auditMock.mockReset();
  enqueueMock.mockReset();
  listWebhooksMock.mockReset();
  createWebhookMock.mockReset();
  updateWebhookMock.mockReset();
  deleteWebhookMock.mockReset();
  mockedAdmin.mockReset();
  mockedAdmin.mockResolvedValue({
    ok: true,
    user: { id: 1, username: 'admin', isAdmin: true },
  });
});

describe('the WeCom webhook admin routes', () => {
  it('refuses a request from a non-admin', async () => {
    mockedAdmin.mockResolvedValue({
      ok: false,
      reason: 'forbidden',
      response: new Response('no', { status: 403 }),
    });
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it('lists the groups', async () => {
    listWebhooksMock.mockResolvedValue([
      { id: 1, name: 'ops', webhookUrl: 'u', enabled: true, categories: ['welcome'] },
    ]);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.webhooks).toHaveLength(1);
  });

  it('refuses to create a group with a URL that is not a WeCom webhook', async () => {
    createWebhookMock.mockRejectedValue(new Error('bad webhook url'));
    const res = await POST(
      new NextRequest('http://localhost/api/admin/wecom/webhooks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'ops',
          webhookUrl: 'https://internal.example.com/hook',
          enabled: true,
          categories: ['welcome'],
        }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it('creates a group and audits it', async () => {
    createWebhookMock.mockResolvedValue(9);
    const res = await POST(
      new NextRequest('http://localhost/api/admin/wecom/webhooks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'ops',
          webhookUrl: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc',
          enabled: true,
          categories: ['welcome'],
        }),
      }),
    );
    expect(res.status).toBe(200);
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'wecom_webhook_created' }),
    );
  });

  it('never audits the webhook URL', async () => {
    createWebhookMock.mockResolvedValue(9);
    await POST(
      new NextRequest('http://localhost/api/admin/wecom/webhooks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'ops',
          webhookUrl: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=secret-key-value',
          enabled: true,
          categories: ['welcome'],
        }),
      }),
    );
    const audited = JSON.stringify(auditMock.mock.calls);
    expect(audited).not.toContain('secret-key-value');
  });

  it('resets a failed delivery so it is pushed again', async () => {
    queryMock.mockResolvedValue([{ affectedRows: 1 }]);
    const res = await RETRY_POST(
      new NextRequest('http://localhost/api/admin/wecom/retry', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: 42 }),
      }),
    );
    expect(res.status).toBe(200);
    const sql = queryMock.mock.calls[0][0] as string;
    expect(sql).toContain('attempts');
    expect(sql).toContain('next_attempt_at');
  });
});
