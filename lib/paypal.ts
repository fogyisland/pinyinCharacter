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
export async function createPayPalOrder(args: {
  amount: string; currency: 'CNY' | 'USD'; description: string;
  returnUrl: string; cancelUrl: string;
}): Promise<PayPalOrder> {
  const cfg = await getPayPalConfig();
  if (!cfg) throw new Error('paypal_not_configured');
  const token = await getPayPalAccessToken(cfg);
  const res = await fetch(`${BASE(cfg.mode)}/v2/checkout/orders`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [{
        amount: { currency_code: args.currency, value: args.amount },
        description: args.description,
      }],
      application_context: { return_url: args.returnUrl, cancel_url: args.cancelUrl },
    }),
  });
  if (!res.ok) throw new Error(`paypal_create_failed: ${res.status} ${await res.text()}`);
  return res.json() as Promise<PayPalOrder>;
}
export async function capturePayPalOrder(orderId: string): Promise<unknown> {
  const cfg = await getPayPalConfig();
  if (!cfg) throw new Error('paypal_not_configured');
  const token = await getPayPalAccessToken(cfg);
  const res = await fetch(`${BASE(cfg.mode)}/v2/checkout/orders/${orderId}/capture`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  });
  if (!res.ok) throw new Error(`paypal_capture_failed: ${res.status} ${await res.text()}`);
  return res.json();
}
export async function verifyWebhookSignature(args: {
  cfg: PayPalConfig; rawBody: string; headers: Record<string, string>;
}): Promise<boolean> {
  const token = await getPayPalAccessToken(args.cfg);
  const res = await fetch(`${BASE(args.cfg.mode)}/v1/notifications/verify-webhook-signature`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      auth_algo: args.headers['paypal-auth-algo'],
      cert_url: args.headers['paypal-cert-url'],
      transmission_id: args.headers['paypal-transmission-id'],
      transmission_sig: args.headers['paypal-transmission-sig'],
      transmission_time: args.headers['paypal-transmission-time'],
      webhook_id: args.cfg.webhookId,
      webhook_event: JSON.parse(args.rawBody),
    }),
  });
  if (!res.ok) return false;
  const j = await res.json() as { verification_status: string };
  return j.verification_status === 'SUCCESS';
}
