import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { sendEmail, EmailNotConfiguredError, EmailSendError } from '@/lib/email';

describe('sendEmail', () => {
  const origEnv = { ...process.env };
  const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

  beforeEach(() => {
    process.env = { ...origEnv };
    consoleSpy.mockClear();
  });

  afterEach(() => {
    process.env = origEnv;
  });

  it('MAIL_TRANSPORT=console writes to console.log', async () => {
    process.env.MAIL_TRANSPORT = 'console';
    await sendEmail({ to: 'a@b.com', subject: 'hi', html: '<p>x</p>', text: 'x' });
    expect(consoleSpy).toHaveBeenCalled();
    const out = consoleSpy.mock.calls[0].join(' ');
    expect(out).toContain('a@b.com');
    expect(out).toContain('hi');
  });

  it('defaults to console when MAIL_TRANSPORT unset', async () => {
    delete process.env.MAIL_TRANSPORT;
    await sendEmail({ to: 'c@d.com', subject: 's', html: 'h', text: 't' });
    expect(consoleSpy).toHaveBeenCalled();
  });

  it('MAIL_TRANSPORT=smtp + missing SMTP_HOST throws EmailNotConfiguredError', async () => {
    process.env.MAIL_TRANSPORT = 'smtp';
    delete process.env.SMTP_HOST;
    await expect(
      sendEmail({ to: 'x@y.com', subject: 's', html: 'h', text: 't' })
    ).rejects.toBeInstanceOf(EmailNotConfiguredError);
  });

  it('MAIL_TRANSPORT=foo throws EmailNotConfiguredError', async () => {
    process.env.MAIL_TRANSPORT = 'foo';
    await expect(
      sendEmail({ to: 'x@y.com', subject: 's', html: 'h', text: 't' })
    ).rejects.toBeInstanceOf(EmailNotConfiguredError);
  });
});
