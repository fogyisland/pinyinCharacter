import nodemailer, { type Transporter } from 'nodemailer';

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

function buildTransport(): Transporter {
  if (cachedTransport) return cachedTransport;
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT ?? 587);
  const secure = process.env.SMTP_SECURE === 'true';
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host) throw new EmailNotConfiguredError('SMTP_HOST is not set');
  cachedTransport = nodemailer.createTransport({
    host, port, secure,
    auth: user && pass ? { user, pass } : undefined,
  });
  return cachedTransport;
}

export async function sendEmail(msg: EmailMessage): Promise<void> {
  const transport = (process.env.MAIL_TRANSPORT ?? 'console').toLowerCase();

  if (transport === 'console') {
    console.log(`[email] To: ${msg.to} | Subject: ${msg.subject}\n${msg.text}`);
    return;
  }

  if (transport !== 'smtp') {
    throw new EmailNotConfiguredError(`Unknown MAIL_TRANSPORT: ${transport}`);
  }

  try {
    const tx = buildTransport();
    const fromName = process.env.MAIL_FROM_NAME ?? '';
    const fromAddr = process.env.MAIL_FROM;
    if (!fromAddr) throw new EmailNotConfiguredError('MAIL_FROM is not set');
    await tx.sendMail({
      from: fromName ? `${fromName} <${fromAddr}>` : fromAddr,
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
