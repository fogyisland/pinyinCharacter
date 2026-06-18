import nodemailer, { type Transporter } from 'nodemailer';
import { getMailTransport, getSmtpConfig } from './smtp-config';

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
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

  if (transport === 'console') {
    console.log(`[email] To: ${msg.to} | Subject: ${msg.subject}\n${msg.text}`);
    return;
  }

  const cfg = await getSmtpConfig();
  if (!cfg) {
    throw new EmailNotConfiguredError('SMTP is not fully configured (set smtp.transport, smtp.host, smtp.from in app_config or SMTP_* in env)');
  }
  if (!cfg.from) {
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
  } catch (e) {
    if (e instanceof EmailNotConfiguredError) throw e;
    cachedTransport = null;
    throw new EmailSendError(e instanceof Error ? e.message : String(e));
  }
}
