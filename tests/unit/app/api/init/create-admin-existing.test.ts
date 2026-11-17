import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({
  getPool: () => ({ query: queryMock }),
}));

import { createAdminUser } from '@/scripts/init-db';

beforeEach(() => {
  queryMock.mockReset();
});

/**
 * `createAdminUser` inserts a row with `is_admin = 1`.
 *
 * It is reachable over HTTP through `POST /api/init/create-admin`, so an
 * instance where it does not check for an EXISTING administrator lets
 * anyone who can reach that route mint a brand-new admin — bypassing the
 * promote/demote admin APIs and, with them, the audit trail.
 */
describe('createAdminUser — refuses when an administrator already exists', () => {
  it('throws when the install already has an administrator', async () => {
    // First query: the username is free. Second query: an admin exists.
    queryMock
      .mockResolvedValueOnce([[]]) // SELECT ... WHERE username = ?
      .mockResolvedValueOnce([[{ id: 1 }]]); // SELECT ... WHERE is_admin = 1

    await expect(
      createAdminUser({ username: 'intruder', password: 'supersecret' }),
    ).rejects.toThrow(/admin_already_exists/);
  });

  it('does not insert the second administrator', async () => {
    queryMock
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[{ id: 1 }]]);

    await expect(
      createAdminUser({ username: 'intruder', password: 'supersecret' }),
    ).rejects.toThrow();

    // Two SELECTs and no INSERT.
    expect(queryMock).toHaveBeenCalledTimes(2);
    for (const call of queryMock.mock.calls) {
      expect(String(call[0])).not.toContain('INSERT');
    }
  });

  it('still refuses when the username is taken', async () => {
    // The username check comes first and keeps its own message.
    queryMock.mockResolvedValueOnce([[{ id: 5 }]]);

    await expect(
      createAdminUser({ username: 'taken', password: 'supersecret' }),
    ).rejects.toThrow(/username_taken/);
    expect(queryMock).toHaveBeenCalledTimes(1);
  });
});

describe('createAdminUser — the first-run case still works', () => {
  it('creates the administrator when the install has none', async () => {
    queryMock
      .mockResolvedValueOnce([[]]) // username free
      .mockResolvedValueOnce([[]]) // no admin yet
      .mockResolvedValueOnce([{ insertId: 99, affectedRows: 1 }]); // INSERT

    const stats = await createAdminUser({
      username: 'firstadmin',
      password: 'supersecret',
      email: 'a@b.com',
    });

    expect(stats.userId).toBe(99);
    expect(stats.username).toBe('firstadmin');
    expect(queryMock).toHaveBeenCalledTimes(3);
    expect(String(queryMock.mock.calls[2][0])).toContain('INSERT INTO users');
  });

  it('writes is_admin = 1', async () => {
    queryMock
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([{ insertId: 99, affectedRows: 1 }]);

    await createAdminUser({ username: 'firstadmin2', password: 'supersecret' });

    // The `1` is inlined in the VALUES clause, not passed as a
    // parameter — so the check is on the SQL text.
    const sql = String(queryMock.mock.calls[2][0]);
    expect(sql).toContain('is_admin');
    expect(sql).toMatch(/VALUES\s*\(\s*\?\s*,\s*\?\s*,\s*\?\s*,\s*1\s*\)/i);
  });
});
