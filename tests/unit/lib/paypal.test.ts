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
});
