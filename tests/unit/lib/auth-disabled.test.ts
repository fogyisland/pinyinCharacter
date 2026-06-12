// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPool, closePool } from '../../../lib/db';
import { isUserDisabled, disableUser, enableUser } from '../../../lib/admin';

describe('auth-disabled', () => {
  let userId: number;
  beforeAll(async () => {
    const pool = getPool();
    await pool.query(`INSERT INTO users (username, password_hash) VALUES ('dis_test', 'x')`);
    const [rows] = await pool.query<any[]>(`SELECT LAST_INSERT_ID() AS id`);
    userId = Number(rows[0].id);
  });
  afterAll(async () => {
    const pool = getPool();
    await pool.query(`DELETE FROM users WHERE id = ?`, [userId]);
    await closePool();
  });

  it('isUserDisabled reflects DB state', async () => {
    expect(await isUserDisabled(userId)).toBe(false);
    await disableUser(userId, 0);
    expect(await isUserDisabled(userId)).toBe(true);
    await enableUser(userId, 0);
    expect(await isUserDisabled(userId)).toBe(false);
  });
});
