import { getConfig } from './config';

export type MailTransport = 'console' | 'smtp';

export interface SmtpConfig {
  transport: MailTransport;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
  fromName: string;
}

const KEYS = {
  transport: 'smtp.transport',
  host: 'smtp.host',
  port: 'smtp.port',
  secure: 'smtp.secure',
  user: 'smtp.user',
  pass: 'smtp.pass',
  from: 'smtp.from',
  fromName: 'smtp.from_name',
} as const;

/**
 * Read the current mail transport ('console' or 'smtp').
 * - Returns 'smtp' when app_config has smtp.transport === 'smtp', or when
 *   the MAIL_TRANSPORT env var is 'smtp' (fallback for deployments that
 *   haven't been migrated to app_config yet).
 * - Returns 'console' for known 'console' values, unknown values (e.g. 'foo'),
 *   or when both DB and env are unset (the safe default).
 */
export async function getMailTransport(): Promise<MailTransport> {
  const dbT = await getConfig(KEYS.transport);
  if (dbT === 'smtp' || dbT === 'console') return dbT;
  const envT = (process.env.MAIL_TRANSPORT ?? '').toLowerCase();
  if (envT === 'smtp' || envT === 'console') return envT;
  return 'console';
}

/**
 * Read SMTP config. If transport is 'console' OR host is missing, returns null
 * (callers should fall back to env or short-circuit). When DB values are
 * absent, fall back to process.env.SMTP_* so existing deployments keep
 * working until an admin saves new values.
 */
export async function getSmtpConfig(): Promise<SmtpConfig | null> {
  const [dbTransport, dbHost, dbPort, dbSecure, dbUser, dbPass, dbFrom, dbFromName] = await Promise.all([
    getConfig(KEYS.transport),
    getConfig(KEYS.host),
    getConfig(KEYS.port),
    getConfig(KEYS.secure),
    getConfig(KEYS.user),
    getConfig(KEYS.pass),
    getConfig(KEYS.from),
    getConfig(KEYS.fromName),
  ]);

  // DB transport must be 'smtp' to return a non-null config.
  if (dbTransport !== 'smtp') return null;

  // Host: DB > env fallback
  const host = dbHost ?? process.env.SMTP_HOST ?? null;
  if (!host) return null;

  const portStr = dbPort ?? process.env.SMTP_PORT;
  const port = portStr ? parseInt(portStr, 10) : 587;

  const secureStr = dbSecure ?? process.env.SMTP_SECURE;
  const secure = secureStr === 'true';

  return {
    transport: 'smtp',
    host,
    port,
    secure,
    user: dbUser ?? process.env.SMTP_USER ?? '',
    pass: dbPass ?? process.env.SMTP_PASS ?? '',
    from: dbFrom ?? process.env.MAIL_FROM ?? '',
    fromName: dbFromName ?? process.env.MAIL_FROM_NAME ?? '',
  };
}
