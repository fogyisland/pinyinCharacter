// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import { getPool, closePool } from '@/lib/db';
import { getPayPalConfig, getPayPalAccessToken, _resetTokenCacheForTest } from '@/lib/paypal';

const HAS_DB = !!process.env.DATABASE_URL_TEST;
const d = HAS_DB ? describe : describe.skip;

d('paypal', () => {
  beforeAll(async () => {
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'integration-test-secret-must-be-32+chars-long';
    process.env.DATABASE_URL = process.env.DATABASE_URL_TEST!;
    const pool = getPool();
    await pool.query('SELECT 1');
    await pool.query(`CREATE TABLE IF NOT EXISTS app_config (
      \`key\` VARCHAR(64) NOT NULL, value TEXT NOT NULL,
      updated_by BIGINT NULL, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (\`key\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  });

  beforeEach(async () => {
    _resetTokenCacheForTest();
    // Clean stale paypal config from prior test runs sharing the same DB
    await getPool().query(`DELETE FROM app_config WHERE \`key\` LIKE 'paypal.%'`);
  });

  afterAll(async () => { await closePool(); });

  it('getPayPalConfig returns null if any required key missing', async () => {
    expect(await getPayPalConfig()).toBeNull();
  });

  it('getPayPalConfig returns full config when all keys set', async () => {
    const pool = getPool();
    for (const [k, v] of [
      ['paypal.mode', 'sandbox'], ['paypal.client_id', 'cid'], ['paypal.client_secret', 'csec'], ['paypal.webhook_id', 'wid'],
    ]) {
      await pool.query(`INSERT INTO app_config (\`key\`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value=VALUES(value)`, [k, v]);
    }
    const cfg = await getPayPalConfig();
    expect(cfg).toEqual({ mode: 'sandbox', clientId: 'cid', clientSecret: 'csec', webhookId: 'wid' });
  });

  it('getPayPalAccessToken caches the token (1 fetch per mode+clientId)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'tok-123', expires_in: 3600 }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const t1 = await getPayPalAccessToken({ mode: 'sandbox', clientId: 'a', clientSecret: 'b', webhookId: 'w' });
    const t2 = await getPayPalAccessToken({ mode: 'sandbox', clientId: 'a', clientSecret: 'b', webhookId: 'w' });
    expect(t1).toBe('tok-123');
    expect(t2).toBe('tok-123');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // different clientId → different cache key → second fetch
    const t3 = await getPayPalAccessToken({ mode: 'sandbox', clientId: 'b', clientSecret: 'b', webhookId: 'w' });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    vi.unstubAllGlobals();
  });

  // --- createPayPalOrder / capturePayPalOrder ---------------------

  async function seedPayPalConfig() {
    const pool = getPool();
    for (const [k, v] of [
      ['paypal.mode', 'sandbox'], ['paypal.client_id', 'c'], ['paypal.client_secret', 's'], ['paypal.webhook_id', 'w'],
    ]) {
      await pool.query(`INSERT INTO app_config (\`key\`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value=VALUES(value)`, [k, v]);
    }
  }

  it('createPayPalOrder posts to /v2/checkout/orders and returns id+approvalUrl', async () => {
    await seedPayPalConfig();
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }),
    }).mockResolvedValueOnce({
      ok: true, json: async () => ({ id: 'PAY-123', status: 'CREATED', links: [
        { rel: 'approve', href: 'https://www.sandbox.paypal.com/checkoutnow?token=PAY-123' },
        { rel: 'self', href: 'https://api-m.sandbox.paypal.com/v2/checkout/orders/PAY-123' },
      ] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { createPayPalOrder } = await import('@/lib/paypal');
    const order = await createPayPalOrder({
      amount: '3.00', currency: 'USD', description: '月卡',
      returnUrl: 'https://x.test/success', cancelUrl: 'https://x.test/cancel',
    });
    expect(order.id).toBe('PAY-123');
    expect(order.links.find(l => l.rel === 'approve')?.href).toContain('PAY-123');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });

  it('createPayPalOrder throws on non-2xx', async () => {
    await seedPayPalConfig();
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }),
    }).mockResolvedValueOnce({
      ok: false, status: 422, text: async () => 'invalid',
    });
    vi.stubGlobal('fetch', fetchMock);
    const { createPayPalOrder } = await import('@/lib/paypal');
    await expect(createPayPalOrder({
      amount: '3.00', currency: 'USD', description: 'x',
      returnUrl: 'https://x/s', cancelUrl: 'https://x/c',
    })).rejects.toThrow(/paypal_create_failed/);
    vi.unstubAllGlobals();
  });

  it('capturePayPalOrder posts to /capture and returns the response', async () => {
    await seedPayPalConfig();
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }),
    }).mockResolvedValueOnce({
      ok: true, json: async () => ({ id: 'PAY-123', status: 'COMPLETED' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const { capturePayPalOrder } = await import('@/lib/paypal');
    const r = await capturePayPalOrder('PAY-123') as any;
    expect(r.status).toBe('COMPLETED');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });

  // --- verifyWebhookSignature -------------------------------------

  it('verifyWebhookSignature posts to /v1/notifications/verify-webhook-signature', async () => {
    await seedPayPalConfig();
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }),
    }).mockResolvedValueOnce({
      ok: true, json: async () => ({ verification_status: 'SUCCESS' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const { verifyWebhookSignature } = await import('@/lib/paypal');
    const ok = await verifyWebhookSignature({
      cfg: { mode: 'sandbox', clientId: 'c', clientSecret: 's', webhookId: 'w' },
      rawBody: '{"id":"WH-1"}',
      headers: {
        'paypal-auth-algo': 'SHA256withRSA',
        'paypal-cert-url': 'https://api.paypal.com/cert.pem',
        'paypal-transmission-id': 'abc-123',
        'paypal-transmission-sig': 'sig',
        'paypal-transmission-time': '2026-06-15T00:00:00Z',
      },
    });
    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });

  it('verifyWebhookSignature returns false on FAILURE status', async () => {
    await seedPayPalConfig();
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }),
    }).mockResolvedValueOnce({
      ok: true, json: async () => ({ verification_status: 'FAILURE' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const { verifyWebhookSignature } = await import('@/lib/paypal');
    const ok = await verifyWebhookSignature({
      cfg: { mode: 'sandbox', clientId: 'c', clientSecret: 's', webhookId: 'w' },
      rawBody: '{}', headers: {
        'paypal-auth-algo': 'SHA256withRSA',
        'paypal-cert-url': 'https://x/cert.pem',
        'paypal-transmission-id': 't',
        'paypal-transmission-sig': 's',
        'paypal-transmission-time': '2026-06-15T00:00:00Z',
      },
    });
    expect(ok).toBe(false);
    vi.unstubAllGlobals();
  });
});
