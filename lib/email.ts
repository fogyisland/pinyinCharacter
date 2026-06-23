import nodemailer, { type Transporter } from 'nodemailer';
import { getMailTransport, getSmtpConfig } from './smtp-config';

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Optional template key, e.g. 'password_reset'. Stored in email_send_history. */
  template?: string;
}

export class EmailNotConfiguredError extends Error {
  code = 'email_not_configured' as const;
}
export class EmailSendError extends Error {
  code = 'email_send_failed' as const;
}

let cachedTransport: Transporter | null = null;

/**
 * Invalidate the cached nodemailer transporter so the next sendEmail() call
 * rebuilds it from the current config. Call this from any code path that
 * mutates SMTP config (e.g. the admin config update route).
 */
export function resetSmtpCache(): void {
  cachedTransport = null;
}

function buildTransport(cfg: NonNullable<Awaited<ReturnType<typeof getSmtpConfig>>>): Transporter {
  if (cachedTransport) return cachedTransport;
  cachedTransport = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: cfg.user && cfg.pass ? { user: cfg.user, pass: cfg.pass } : undefined,
  });
  return cachedTransport;
}

export async function sendEmail(msg: EmailMessage): Promise<void> {
  const transport = await getMailTransport();
  const at = new Date();

  if (transport === 'console') {
    console.log(`[email] To: ${msg.to} | Subject: ${msg.subject}\n${msg.text}`);
    await recordSend({ msg, status: 'console', at });
    return;
  }

  const cfg = await getSmtpConfig();
  if (!cfg) {
    await recordSend({ msg, status: 'failed', at, error: 'SMTP not configured' });
    throw new EmailNotConfiguredError('SMTP is not fully configured (set smtp.transport, smtp.host, smtp.from in app_config or SMTP_* in env)');
  }
  if (!cfg.from) {
    await recordSend({ msg, status: 'failed', at, error: 'MAIL_FROM not set' });
    throw new EmailNotConfiguredError('MAIL_FROM is not set');
  }

  try {
    const tx = buildTransport(cfg);
    await tx.sendMail({
      from: cfg.fromName ? `${cfg.fromName} <${cfg.from}>` : cfg.from,
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
    });
    await recordSend({ msg, status: 'sent', at });
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    await recordSend({ msg, status: 'failed', at, error: err });
    if (e instanceof EmailNotConfiguredError) throw e;
    cachedTransport = null;
    throw new EmailSendError(err);
  }
}

interface RecordSendArgs {
  msg: EmailMessage;
  status: 'sent' | 'failed' | 'console';
  at: Date;
  error?: string;
}

async function recordSend(args: RecordSendArgs): Promise<void> {
  try {
    const { getPool } = await import('./db');
    const truncate = (s: string | undefined, n: number) => {
      if (!s) return null;
      return s.length > n ? s.slice(0, n - 3) + '...' : s;
    };
    await getPool().query(
      `INSERT INTO email_send_history (to_addr, subject, template, status, error, sent_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        args.msg.to,
        truncate(args.msg.subject, 512),
        truncate(args.msg.template, 64),
        args.status,
        truncate(args.error, 1024),
        args.at,
      ],
    );
  } catch (err) {
    // Never let history logging break the mailer.
    console.warn('[email] history insert failed:', (err as Error).message);
  }
}
