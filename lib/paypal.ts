/**
 * PayPal REST client (no SDK — fetch + REST).
 *
 * Token cache: module-level, keyed by `${mode}:${clientId}`, TTL 50min
 * (PayPal access tokens are valid 60min, we refresh 10min early).
 *
 * Race condition note: webhook handles capture (server-side) on
 * CHECKOUT.ORDER.APPROVED. The /membership/success page is read-only
 * polling — it MUST NOT call capture. The webhook is the sole capture
 * trigger.
 */
import { getPool } from './db';

export type PayPalMode = 'sandbox' | 'live';
export interface PayPalConfig {
  mode: PayPalMode; clientId: string; clientSecret: string; webhookId: string;
}

interface TokenEntry { token: string; expiresAt: number; }
const tokenCache: Map<string, TokenEntry> = new Map();
const TOKEN_TTL_MS = 50 * 60 * 1000;

const BASE = (mode: PayPalMode) =>
  mode === 'sandbox' ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com';

export async function getPayPalConfig(): Promise<PayPalConfig | null> {
  const [rows] = await getPool().query<any[]>(
    `SELECT \`key\`, value FROM app_config WHERE \`key\` IN
       ('paypal.mode','paypal.client_id','paypal.client_secret','paypal.webhook_id')`,
  );
  const map: Record<string, string> = {};
  for (const r of rows as any[]) map[r.key] = r.value;
  const mode = map['paypal.mode'];
  const clientId = map['paypal.client_id'];
  const clientSecret = map['paypal.client_secret'];
  const webhookId = map['paypal.webhook_id'];
  if (!mode || !clientId || !clientSecret || !webhookId) return null;
  if (mode !== 'sandbox' && mode !== 'live') return null;
  return { mode, clientId, clientSecret, webhookId };
}

export async function getPayPalAccessToken(cfg: PayPalConfig): Promise<string> {
  const key = `${cfg.mode}:${cfg.clientId}`;
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  const auth = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64');
  const res = await fetch(`${BASE(cfg.mode)}/v1/oauth2/token`, {
    method: 'POST',
    headers: { authorization: `Basic ${auth}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`paypal_oauth_failed: ${res.status}`);
  const j = await res.json() as { access_token: string; expires_in: number };
  tokenCache.set(key, { token: j.access_token, expiresAt: Date.now() + TOKEN_TTL_MS });
  return j.access_token;
}

export function _resetTokenCacheForTest(): void {
  tokenCache.clear();
}

export interface PayPalOrder {
  id: string; status: string;
  links: { href: string; rel: string }[];
}
export async function createPayPalOrder(_args: {
  amount: string; currency: 'CNY' | 'USD'; description: string;
  returnUrl: string; cancelUrl: string;
}): Promise<PayPalOrder> {
  throw new Error('createPayPalOrder not yet implemented');
}
export async function capturePayPalOrder(_orderId: string): Promise<unknown> {
  throw new Error('capturePayPalOrder not yet implemented');
}
export async function verifyWebhookSignature(_args: {
  rawBody: string; headers: Record<string, string>;
}): Promise<boolean> {
  throw new Error('verifyWebhookSignature not yet implemented');
}
