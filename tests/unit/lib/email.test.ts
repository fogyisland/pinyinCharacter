import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { sendEmail, EmailNotConfiguredError, EmailSendError } from '@/lib/email';
import { setConfig } from '@/lib/config';
import { getPool, closePool } from '@/lib/db';

// @vitest-environment node
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

  afterAll(async () => {
    await getPool().query(`DELETE FROM app_config WHERE \`key\` LIKE 'smtp.%'`);
    await closePool();
  });

  it('MAIL_TRANSPORT=console writes to console.log', async () => {
    process.env.MAIL_TRANSPORT = 'console';
    await sendEmail({ to: 'a@b.com', subject: 'hi', html: '<p>x</p>', text: 'x' });
    expect(consoleSpy).toHaveBeenCalled();
    const out = consoleSpy.mock.calls[0].join(' ');
    expect(out).toContain('a@b.com');
    expect(out).toContain('hi');
  });

  it('defaults to console when MAIL_TRANSPORT unset and no DB entry', async () => {
    delete process.env.MAIL_TRANSPORT;
    await sendEmail({ to: 'c@d.com', subject: 's', html: 'h', text: 't' });
    expect(consoleSpy).toHaveBeenCalled();
  });

  it('MAIL_TRANSPORT=smtp + missing host throws EmailNotConfiguredError', async () => {
    process.env.MAIL_TRANSPORT = 'smtp';
    delete process.env.SMTP_HOST;
    // also clear DB to make sure env path triggers
    await getPool().query(`DELETE FROM app_config WHERE \`key\` = 'smtp.host'`);
    await expect(
      sendEmail({ to: 'x@y.com', subject: 's', html: 'h', text: 't' })
    ).rejects.toBeInstanceOf(EmailNotConfiguredError);
  });

  it('MAIL_TRANSPORT=foo falls back to console (unknown value treated as console)', async () => {
    process.env.MAIL_TRANSPORT = 'foo';
    await sendEmail({ to: 'x@y.com', subject: 's', html: 'h', text: 't' });
    expect(consoleSpy).toHaveBeenCalled();
  });

  it('DB smtp.transport=smtp takes precedence over env=console', async () => {
    process.env.MAIL_TRANSPORT = 'console';
    await setConfig('smtp.transport', 'smtp', null);
    await setConfig('smtp.host', 'localhost', null);
    await setConfig('smtp.from', 'test@local.test', null);
    // We expect it to TRY to send (not console.log). The send will fail
    // because localhost isn't a real SMTP server, but the failure mode is
    // EmailSendError, not console output.
    await expect(
      sendEmail({ to: 'x@y.com', subject: 's', html: 'h', text: 't' })
    ).rejects.toBeInstanceOf(EmailSendError);
    expect(consoleSpy).not.toHaveBeenCalled();
  });
});
