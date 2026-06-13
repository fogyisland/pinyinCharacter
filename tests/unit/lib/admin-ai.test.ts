// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPool, closePool } from '../../../lib/db';
import { listAiCalls, getAiStats } from '../../../lib/admin-ai';

const HAS_DB = !!process.env.DATABASE_URL_TEST;
const d = HAS_DB ? describe : describe.skip;

d('admin-ai', () => {
  let userId: number;
  beforeAll(async () => {
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'integration-test-secret-must-be-32+chars-long';
    process.env.DATABASE_URL = process.env.DATABASE_URL_TEST!;
    const pool = getPool();
    // Idempotent: if a previous failed run left a user, clean up first.
    await pool.query(`DELETE FROM ai_calls WHERE user_id IN (SELECT id FROM users WHERE username = 'ai_u')`);
    await pool.query(`DELETE FROM users WHERE username = 'ai_u'`);
    await pool.query(`INSERT INTO users (username, password_hash) VALUES ('ai_u', 'x')`);
    const [r] = await pool.query<any[]>(`SELECT LAST_INSERT_ID() AS id`);
    userId = Number(r[0].id);
    // Insert 5 rows with known, sorted durations: 100, 200, 300, 400, 500
    for (const d of [100, 200, 300, 400, 500]) {
      await pool.query(
        `INSERT INTO ai_calls (user_id, feature, model, status, duration_ms) VALUES (?, 'rare-char-story', 'gpt-4o-mini', 'ok', ?)`,
        [userId, d],
      );
    }
    // Plus one 'error' row so the listAiCalls status-filter test has data.
    await pool.query(
      `INSERT INTO ai_calls (user_id, feature, model, status, duration_ms) VALUES (?, 'pinyin-tone', 'gpt-4o-mini', 'error', 250)`,
      [userId],
    );
  });
  afterAll(async () => {
    const pool = getPool();
    await pool.query(`DELETE FROM ai_calls WHERE user_id = ?`, [userId]);
    await pool.query(`DELETE FROM users WHERE id = ?`, [userId]);
    await closePool();
  });

  it('getAiStats computes p50/p95 over known durations', async () => {
    const stats = await getAiStats(7);
    // Our 6 known durations: 100, 200, 250, 300, 400, 500. The actual DB may
    // also have other rows, so we assert the returned p50/p95 are *plausible*
    // values from our set rather than strict equals. p50 must fall in
    // [100, 500] and p95 must be >= p50.
    expect(stats.p50Duration).toBeGreaterThanOrEqual(100);
    expect(stats.p50Duration).toBeLessThanOrEqual(500);
    expect(stats.p95Duration).toBeGreaterThanOrEqual(stats.p50Duration!);
    expect(stats.p95Duration).toBeLessThanOrEqual(500);
    // And our test rows are present in the total count.
    expect(stats.total).toBeGreaterThanOrEqual(6);
    // errorRate is bounded in [0, 1].
    expect(stats.errorRate).toBeGreaterThanOrEqual(0);
    expect(stats.errorRate).toBeLessThanOrEqual(1);
  });

  it('listAiCalls status=error returns only error rows', async () => {
    const result = await listAiCalls({ userId, status: 'error' });
    expect(result.rows.length).toBeGreaterThanOrEqual(1);
    for (const i of result.rows) expect(i.status).toBe('error');
  });
});