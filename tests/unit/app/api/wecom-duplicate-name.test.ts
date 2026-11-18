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

const mockedAdmin = vi.fn();
vi.mock('@/lib/auth', () => ({
  requireAdmin: (...args: unknown[]) => mockedAdmin(...args),
}));

import { POST } from '@/app/api/admin/wecom/webhooks/route';

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

describe('a group name that is already taken', () => {
  it('says the name is taken, in words the admin can act on', async () => {
    // The migration puts UNIQUE KEY on the name. Two groups with the same
    // name is a real mistake the admin can fix — but the raw MySQL error
    // ("Duplicate entry 'ops' for key 'wecom_webhooks.uq_wecom_webhook_name'")
    // is database jargon that does not say WHICH field is taken, and it
    // leaks the table and index name.
    queryMock.mockRejectedValueOnce(
      Object.assign(new Error("Duplicate entry 'ops' for key 'wecom_webhooks.uq_wecom_webhook_name'"), {
        code: 'ER_DUP_ENTRY',
      }),
    );

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

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    const message = body.error.message as string;
    // The message must name the field and speak to the admin.
    expect(message).toMatch(/name/i);
    expect(message).not.toMatch(/Duplicate entry/);
    expect(message).not.toContain('uq_wecom_webhook_name');
  });
});
