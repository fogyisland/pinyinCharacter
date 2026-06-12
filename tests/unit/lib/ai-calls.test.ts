// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPool, closePool } from '../../../lib/db';
import { logAiCall, checkAiRateLimit, withAiLogging } from '../../../lib/ai-calls';

describe('ai-calls', () => {
  let userId: number;
  beforeAll(async () => {
    const pool = getPool();
    await pool.query(`INSERT INTO users (username, password_hash) VALUES ('ai_test', 'x')`);
    const [rows] = await pool.query<any[]>(`SELECT LAST_INSERT_ID() AS id`);
    userId = Number(rows[0].id);
  });
  afterAll(async () => {
    const pool = getPool();
    await pool.query(`DELETE FROM ai_calls WHERE user_id = ?`, [userId]);
    await pool.query(`DELETE FROM users WHERE id = ?`, [userId]);
    await closePool();
  });

  it('logAiCall inserts a row', async () => {
    await logAiCall({
      userId,
      feature: 'rare-char-story',
      model: 'gpt-4o-mini',
      status: 'ok',
      durationMs: 250,
      metadata: { char: '龘' },
    });
    const [rows] = await getPool().query<any[]>(
      `SELECT * FROM ai_calls WHERE user_id = ? ORDER BY id DESC LIMIT 1`,
      [userId],
    );
    expect(rows[0].feature).toBe('rare-char-story');
    expect(rows[0].model).toBe('gpt-4o-mini');
    expect(rows[0].status).toBe('ok');
    expect(Number(rows[0].duration_ms)).toBe(250);
  });

  it('withAiLogging wraps a function and logs the call', async () => {
    const result = await withAiLogging(
      { userId, feature: 'rare-char-story', metadata: { test: 1 } },
      async () => 'hello',
    );
    expect(result).toBe('hello');
    const [rows] = await getPool().query<any[]>(
      `SELECT * FROM ai_calls WHERE user_id = ? AND feature = 'rare-char-story' ORDER BY id DESC LIMIT 1`,
      [userId],
    );
    expect(rows[0].status).toBe('ok');
  });

  it('withAiLogging logs error and re-throws on failure', async () => {
    await expect(
      withAiLogging({ userId, feature: 'rare-char-story' }, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const [rows] = await getPool().query<any[]>(
      `SELECT * FROM ai_calls WHERE user_id = ? AND status = 'error' ORDER BY id DESC LIMIT 1`,
      [userId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].error).toContain('boom');
  });

  it('checkAiRateLimit returns true when under limit', async () => {
    const ok = await checkAiRateLimit(userId);
    expect(ok).toBe(true);
  });
});
