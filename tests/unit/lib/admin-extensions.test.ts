// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPool, closePool } from '../../../lib/db';
import { disableUser, enableUser, isUserDisabled, listUsers } from '../../../lib/admin';

describe('admin-extensions', () => {
  let userId: number;
  beforeAll(async () => {
    const pool = getPool();
    await pool.query(`INSERT INTO users (username, password_hash) VALUES ('ext_test', 'x')`);
    const [rows] = await pool.query<any[]>(`SELECT LAST_INSERT_ID() AS id`);
    userId = Number(rows[0].id);
  });
  afterAll(async () => {
    const pool = getPool();
    await pool.query(`DELETE FROM users WHERE id = ?`, [userId]);
    await closePool();
  });

  it('disableUser sets disabled_at', async () => {
    await disableUser(userId, 0);
    expect(await isUserDisabled(userId)).toBe(true);
  });

  it('enableUser clears disabled_at', async () => {
    await enableUser(userId, 0);
    expect(await isUserDisabled(userId)).toBe(false);
  });

  it('listUsers filters by disabled', async () => {
    await disableUser(userId, 0);
    const all = await listUsers({ limit: 200 });
    const only = await listUsers({ disabled: true, limit: 200 });
    expect(only.users.find(u => u.id === userId)).toBeTruthy();
    expect(all.users.find(u => u.id === userId && u.disabledAt)).toBeTruthy();
    await enableUser(userId, 0);
  });
});
