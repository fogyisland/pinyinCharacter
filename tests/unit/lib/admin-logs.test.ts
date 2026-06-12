// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPool, closePool } from '../../../lib/db';
import { listUnifiedLogs } from '../../../lib/admin-logs';

const HAS_DB = !!process.env.DATABASE_URL_TEST;
const d = HAS_DB ? describe : describe.skip;

d('listUnifiedLogs', () => {
  let userId: number;
  beforeAll(async () => {
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'integration-test-secret-must-be-32+chars-long';
    process.env.DATABASE_URL = process.env.DATABASE_URL_TEST!;
    const pool = getPool();
    await pool.query(`INSERT INTO users (username, password_hash) VALUES ('log_u', 'x')`);
    const [r] = await pool.query<any[]>(`SELECT LAST_INSERT_ID() AS id`);
    userId = Number(r[0].id);
    await pool.query(`INSERT INTO audit_log (user_id, event) VALUES (?, 'login')`, [userId]);
    await pool.query(`INSERT INTO downloads (user_id, format, source_type, source_id) VALUES (?, 'print', 'poem', '1')`, [userId]);
    await pool.query(`INSERT INTO ai_calls (user_id, feature, model, status) VALUES (?, 'rare-char-story', 'gpt-4o-mini', 'ok')`, [userId]);
  });
  afterAll(async () => {
    const pool = getPool();
    await pool.query(`DELETE FROM audit_log WHERE user_id = ?`, [userId]);
    await pool.query(`DELETE FROM downloads WHERE user_id = ?`, [userId]);
    await pool.query(`DELETE FROM ai_calls WHERE user_id = ?`, [userId]);
    await pool.query(`DELETE FROM users WHERE id = ?`, [userId]);
    await closePool();
  });

  it('returns items from all 3 sources, sorted desc by createdAt', async () => {
    const result = await listUnifiedLogs({ userId });
    expect(result.items).toHaveLength(3);
    const sources = new Set(result.items.map(i => i.source));
    expect(sources).toEqual(new Set(['audit', 'download', 'ai_call']));
    // Sort check
    for (let i = 0; i < result.items.length - 1; i++) {
      expect(new Date(result.items[i].createdAt).getTime()).toBeGreaterThanOrEqual(new Date(result.items[i + 1].createdAt).getTime());
    }
  });

  it('source=download returns only download rows', async () => {
    const result = await listUnifiedLogs({ userId, source: 'download' });
    expect(result.items.length).toBeGreaterThanOrEqual(1);
    for (const item of result.items) expect(item.source).toBe('download');
  });

  it('source=audit returns only audit rows', async () => {
    const result = await listUnifiedLogs({ userId, source: 'audit' });
    expect(result.items.length).toBeGreaterThanOrEqual(1);
    for (const item of result.items) expect(item.source).toBe('audit');
  });

  it('source=ai_call returns only ai_call rows', async () => {
    const result = await listUnifiedLogs({ userId, source: 'ai_call' });
    expect(result.items.length).toBeGreaterThanOrEqual(1);
    for (const item of result.items) expect(item.source).toBe('ai_call');
  });

  it('type=login matches audit event column (plain event match)', async () => {
    const result = await listUnifiedLogs({ userId, source: 'audit', type: 'login' });
    expect(result.items.length).toBeGreaterThanOrEqual(1);
    for (const item of result.items) {
      expect(item.source).toBe('audit');
      expect(item.event).toBe('login');
    }
  });

  it('type=download_logged with source=download matches all download rows', async () => {
    const result = await listUnifiedLogs({ userId, source: 'download', type: 'download_logged' });
    expect(result.items.length).toBeGreaterThanOrEqual(1);
    for (const item of result.items) expect(item.source).toBe('download');
  });

  it('type=login with source=download returns 0 rows (no download row has event=login)', async () => {
    const result = await listUnifiedLogs({ userId, source: 'download', type: 'login' });
    expect(result.items).toHaveLength(0);
  });

  it('total is sum of accurate counts across included sources (regression for Bug 1)', async () => {
    const result = await listUnifiedLogs({ userId });
    // Each source has exactly 1 row for this user (inserted in beforeAll).
    expect(result.total).toBe(3);
  });
});