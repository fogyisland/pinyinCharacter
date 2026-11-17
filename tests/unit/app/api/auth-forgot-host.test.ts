import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const sendEmailMock = vi.fn();
vi.mock('@/lib/email', () => ({
  sendEmail: (...args: unknown[]) => sendEmailMock(...args),
}));

const auditMock = vi.fn();
vi.mock('@/lib/audit', () => ({
  writeAudit: (...args: unknown[]) => auditMock(...args),
}));

const siteUrlMock = vi.fn();
vi.mock('@/lib/seo/config', () => ({
  getRuntimeSiteUrl: (...args: unknown[]) => siteUrlMock(...args),
}));

const findUserMock = vi.fn();
const createResetRowMock = vi.fn();
vi.mock('@/lib/password-reset', () => ({
  findUserByUsername: (...args: unknown[]) => findUserMock(...args),
  generateResetToken: () => 'the-reset-token',
  createResetRow: (...args: unknown[]) => createResetRowMock(...args),
  RESET_TTL_MINUTES: 15,
}));

import { POST } from '@/app/api/auth/forgot/route';

beforeEach(() => {
  vi.clearAllMocks();
  sendEmailMock.mockResolvedValue(undefined);
  findUserMock.mockResolvedValue({ id: 7 });
  createResetRowMock.mockResolvedValue(1);
  siteUrlMock.mockResolvedValue('https://pinyin.example.com');
});

let ipCounter = 0;
function nextIp(): string {
  ipCounter += 1;
  return '203.0.113.' + ipCounter;
}

function postReq(host: string, username = 'someone'): NextRequest {
  return new NextRequest('http://localhost/api/auth/forgot', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': nextIp(),
      host,
    },
    body: JSON.stringify({ username }),
  });
}

describe('POST /api/auth/forgot — the reset link host is not attacker-supplied', () => {
  it('builds the link from the configured site URL, not from the Host header', async () => {
    // Taking the host from the request let an attacker send
    // `Host: evil.example` and receive a GENUINE reset email, from the
    // real SMTP relay, containing a link to
    // `http://evil.example/reset-password?token=…`. Clicking it hands
    // the token to the attacker, who can then POST it to /api/auth/reset
    // and take over the account.
    await POST(postReq('evil.example'));

    const sent = sendEmailMock.mock.calls[0][0] as { html: string; text: string };
    expect(sent.html).toContain('https://pinyin.example.com/reset-password');
    expect(sent.html).not.toContain('evil.example');
    expect(sent.text).not.toContain('evil.example');
  });

  it('does not leak the attacker host anywhere in the email', async () => {
    await POST(postReq('attacker.test'));
    const sent = sendEmailMock.mock.calls[0][0] as { html: string; text: string; subject: string };
    const blob = [sent.html, sent.text, sent.subject].join('\n');
    expect(blob).not.toContain('attacker.test');
  });

  it('encodes the token into the query string', async () => {
    await POST(postReq('evil.example'));
    const sent = sendEmailMock.mock.calls[0][0] as { html: string };
    expect(sent.html).toContain('token=the-reset-token');
  });

  it('never emits a plain-http link when the site is configured with https', async () => {
    // The old code hardcoded `http://` as the fallback scheme, so the
    // token travelled in clear text.
    await POST(postReq('evil.example'));
    const sent = sendEmailMock.mock.calls[0][0] as { html: string };
    expect(sent.html).not.toContain('http://pinyin.example.com');
  });
});

describe('POST /api/auth/forgot — the response does not reveal whether the user exists', () => {
  it('answers the same for an unknown username', async () => {
    findUserMock.mockResolvedValue(null);
    const res = await POST(postReq('pinyin.example.com', 'ghost'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; data: null };
    expect(body.ok).toBe(true);
    expect(body.data).toBeNull();
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('answers the same for a known username', async () => {
    const res = await POST(postReq('pinyin.example.com', 'real'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; data: null };
    expect(body.ok).toBe(true);
    expect(body.data).toBeNull();
  });
});
