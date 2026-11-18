import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const enqueueMock = vi.fn();
// ⚠️ The mock must return a PROMISE, like the real `enqueueWecomNotification`
// does — `sendEmail` calls `.catch()` on the result, and a mock that returns
// undefined makes the production code throw a TypeError instead of
// exercising the real path.
vi.mock('@/lib/wecom-deliver', () => ({
  enqueueWecomNotification: (...args: unknown[]) => enqueueMock(...args),
}));

vi.mock('@/lib/smtp-config', () => ({
  getMailTransport: vi.fn(async () => 'console'),
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

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({
  getPool: () => ({ query: queryMock }),
}));

// nodemailer must never open a socket in a unit test. The transporter is
// replaced with a stub whose sendMail the test controls.
const sendMailMock = vi.fn();
vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn(() => ({ sendMail: (...args: unknown[]) => sendMailMock(...args) })),
  },
}));

import { sendEmail } from '@/lib/email';
import { getMailTransport } from '@/lib/smtp-config';

const mockedTransport = vi.mocked(getMailTransport);
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  enqueueMock.mockReset();
  enqueueMock.mockResolvedValue(0);
  sendMailMock.mockReset();
  sendMailMock.mockResolvedValue({ messageId: 'test' });
  queryMock.mockReset();
  queryMock.mockResolvedValue([{ affectedRows: 1 }]);
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
});

describe('forwarding a notification to the WeCom groups', () => {
  it('queues the notification with its category, title and body', async () => {
    mockedTransport.mockResolvedValue('smtp');
    await sendEmail({
      to: 'a@example.com',
      subject: '新留言',
      html: '<p>正文</p>',
      text: '正文',
      template: 'notes_notification',
    });
    expect(enqueueMock).toHaveBeenCalledWith(
      'notes_notification',
      '新留言',
      '正文',
    );
  });

  it('does not queue a notification with no category', async () => {
    // Without a template key the notification cannot be categorised, so
    // there is nothing to match a group's checkboxes against.
    mockedTransport.mockResolvedValue('smtp');
    await sendEmail({
      to: 'a@example.com',
      subject: '标题',
      html: '<p>正文</p>',
      text: '正文',
    });
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it('does not queue in console mode', async () => {
    // The console transport is the development mode. It must not push into
    // a real group while somebody is developing.
    mockedTransport.mockResolvedValue('console');
    await sendEmail({
      to: 'a@example.com',
      subject: '标题',
      html: '<p>正文</p>',
      text: '正文',
      template: 'notes_notification',
    });
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it('still sends the mail when the queueing fails', async () => {
    mockedTransport.mockResolvedValue('smtp');
    enqueueMock.mockRejectedValue(new Error('queue blew up'));
    await expect(
      sendEmail({
        to: 'a@example.com',
        subject: '标题',
        html: '<p>正文</p>',
        text: '正文',
        template: 'notes_notification',
      }),
    ).resolves.toBeUndefined();
  });

  it('queues the notification even when the mail itself fails', async () => {
    // The forwarding is a separate channel. A message the group should see
    // is queued whether or not SMTP accepted the mail.
    mockedTransport.mockResolvedValue('smtp');
    sendMailMock.mockRejectedValue(new Error('smtp refused'));
    await expect(
      sendEmail({
        to: 'a@example.com',
        subject: '标题',
        html: '<p>正文</p>',
        text: '正文',
        template: 'notes_notification',
      }),
    ).rejects.toThrow();
    expect(enqueueMock).toHaveBeenCalledWith(
      'notes_notification',
      '标题',
      '正文',
    );
  });
});
