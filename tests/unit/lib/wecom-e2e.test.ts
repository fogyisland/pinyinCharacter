import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({
  getPool: () => ({ query: queryMock }),
}));

vi.mock('@/lib/smtp-config', () => ({
  getMailTransport: vi.fn(async () => 'smtp'),
  getSmtpConfig: vi.fn(async () => ({
    transport: 'smtp',
    host: 'smtp.example.com',
    port: 587,
    secure: false,
    user: 'u',
    pass: 'p',
    from: 'a@example.com',
    fromName: 'A',
  })),
}));

vi.mock('@/lib/wecom-webhooks', () => ({
  webhooksForCategory: vi.fn(async () => [
    {
      id: 7,
      name: 'ops',
      webhookUrl: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc',
      enabled: true,
      categories: ['notes_notification'],
    },
  ]),
}));

// nodemailer must never open a socket in a unit test.
const sendMailMock = vi.fn();
vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn(() => ({ sendMail: (...args: unknown[]) => sendMailMock(...args) })),
  },
}));

import { sendEmail } from '@/lib/email';

beforeEach(() => {
  vi.clearAllMocks();
  queryMock.mockReset();
  sendMailMock.mockReset();
  sendMailMock.mockResolvedValue({ messageId: 'test' });
  queryMock.mockResolvedValue([{ insertId: 1, affectedRows: 1 }]);
});

/**
 * Wait until the fire-and-forget queue write has landed.
 *
 * `sendEmail()` queues the forwarding with `void promise.catch(...)` — it
 * does NOT await it, on purpose: the request path must not wait for the
 * queue. So `await sendEmail(...)` returns BEFORE the INSERT happens, and
 * asserting on `queryMock.mock.calls` right after is a race that passes
 * about half the time. This helper drains the microtask queue until the
 * insert shows up (or the attempts run out).
 */
async function waitForQueueInsert(): Promise<unknown[][]> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const inserts = queryMock.mock.calls.filter((call) =>
      String(call[0]).includes('INSERT INTO wecom_deliveries'),
    );
    if (inserts.length > 0) return inserts;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return queryMock.mock.calls.filter((call) =>
    String(call[0]).includes('INSERT INTO wecom_deliveries'),
  );
}

describe('a notification travels from the mailer into the queue', () => {
  it('writes a queue row with the category, the title and the body', async () => {
    await sendEmail({
      to: 'admin@example.com',
      subject: '新留言： somebody',
      html: '<p>正文</p>',
      text: '正文',
      template: 'notes_notification',
    });

    const inserts = await waitForQueueInsert();
    expect(inserts).toHaveLength(1);
    const params = inserts[0][1] as unknown[];
    expect(params).toContain(7);
    expect(params).toContain('notes_notification');
    expect(params).toContain('新留言： somebody');
    expect(params).toContain('正文');
  });

  it('writes one queue row per matching group', async () => {
    // Two groups want this category ⇒ two rows, one per group.
    const { webhooksForCategory } = await import('@/lib/wecom-webhooks');
    vi.mocked(webhooksForCategory).mockResolvedValue([
      {
        id: 7,
        name: 'ops',
        webhookUrl: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc',
        enabled: true,
        categories: ['notes_notification'],
      },
      {
        id: 8,
        name: 'dev',
        webhookUrl: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=def',
        enabled: true,
        categories: ['notes_notification'],
      },
    ]);

    await sendEmail({
      to: 'admin@example.com',
      subject: '标题',
      html: '<p>正文</p>',
      text: '正文',
      template: 'notes_notification',
    });

    const inserts = await waitForQueueInsert();
    expect(inserts).toHaveLength(2);
    const webhookIds = inserts.map((call) => (call[1] as unknown[])[0]);
    expect(webhookIds).toEqual([7, 8]);
  });
});
