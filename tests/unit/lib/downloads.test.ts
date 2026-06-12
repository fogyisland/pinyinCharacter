// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPool, closePool } from '../../../lib/db';
import { logDownload } from '../../../lib/downloads';

describe('logDownload', () => {
  let userId: number;
  beforeAll(async () => {
    const pool = getPool();
    await pool.query(`INSERT INTO users (username, password_hash) VALUES ('dl_test', 'x')`);
    const [rows] = await pool.query<any[]>(`SELECT LAST_INSERT_ID() AS id`);
    userId = Number(rows[0].id);
  });
  afterAll(async () => {
    const pool = getPool();
    await pool.query(`DELETE FROM downloads WHERE user_id = ?`, [userId]);
    await pool.query(`DELETE FROM users WHERE id = ?`, [userId]);
    await closePool();
  });

  it('inserts a row with all fields', async () => {
    await logDownload({
      userId,
      format: 'print',
      sourceType: 'poem',
      sourceId: '42',
      status: 'ok',
      durationMs: 123,
      ip: '127.0.0.1',
    });
    const [rows] = await getPool().query<any[]>(
      `SELECT * FROM downloads WHERE user_id = ? ORDER BY id DESC LIMIT 1`,
      [userId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].format).toBe('print');
    expect(rows[0].source_type).toBe('poem');
    expect(rows[0].source_id).toBe('42');
    expect(rows[0].status).toBe('ok');
    expect(Number(rows[0].duration_ms)).toBe(123);
    expect(rows[0].ip).toBe('127.0.0.1');
  });

  it('does not throw when insert fails (fail-soft)', async () => {
    // pass userId that doesn't exist → FK fails
    await expect(
      logDownload({
        userId: 99999999,
        format: 'print',
        sourceType: 'poem',
        sourceId: 'x',
      }),
    ).resolves.toBeUndefined();
  });
});
