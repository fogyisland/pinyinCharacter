import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({
  getPool: () => ({ query: queryMock }),
}));

import { createResetRow, hashResetToken, generateResetToken } from '@/lib/password-reset';

beforeEach(() => {
  queryMock.mockReset();
});

/**
 * Issuing a new reset token must cut off the old one.
 *
 * Each token was individually single-use, but a user who requested a
 * reset twice held TWO independently valid tokens, and the OLD one stayed
 * usable for its full 15-minute life. So an attacker who had obtained an
 * earlier reset email — a leaked inbox, a shared mailbox, a Referer leak —
 * kept a working password-reset capability long after the user had asked
 * for a new one.
 *
 * Users rely on "I asked for a new link" to cut off a compromised link.
 * Without invalidating the previous tokens, that did nothing.
 */
describe('createResetRow — a new token invalidates the old ones', () => {
  it('marks every outstanding token for the user as used, before inserting', async () => {
    queryMock
      .mockResolvedValueOnce([{ affectedRows: 2 }]) // the UPDATE
      .mockResolvedValueOnce([{ insertId: 42, affectedRows: 1 }]); // the INSERT

    const id = await createResetRow(7, 'raw-token-value');

    expect(id).toBe(42);
    expect(queryMock).toHaveBeenCalledTimes(2);

    const invalidateSql = String(queryMock.mock.calls[0][0]);
    expect(invalidateSql).toContain('UPDATE password_resets');
    expect(invalidateSql).toContain('used_at = NOW()');
    expect(invalidateSql).toContain('user_id = ?');
    expect(invalidateSql).toContain('used_at IS NULL');

    const invalidateParams = queryMock.mock.calls[0][1] as unknown[];
    expect(invalidateParams).toEqual([7]);
  });

  it('invalidates before inserting, so the new token is not the one being burned', async () => {
    queryMock
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ insertId: 43, affectedRows: 1 }]);

    await createResetRow(7, 'raw-token-value');

    const invalidateSql = String(queryMock.mock.calls[0][0]);
    const insertSql = String(queryMock.mock.calls[1][0]);
    expect(invalidateSql).toContain('UPDATE');
    expect(insertSql).toContain('INSERT');
  });

  it('stores only the HASH of the token, never the raw value', async () => {
    queryMock
      .mockResolvedValueOnce([{ affectedRows: 0 }])
      .mockResolvedValueOnce([{ insertId: 44, affectedRows: 1 }]);

    const raw = 'a-raw-token-that-must-not-be-stored';
    await createResetRow(7, raw);

    const insertSql = String(queryMock.mock.calls[1][0]);
    const insertParams = queryMock.mock.calls[1][1] as unknown[];
    expect(insertSql).toContain('token_hash');
    expect(insertParams).toContain(hashResetToken(raw));
    expect(insertParams).not.toContain(raw);
  });
});

describe('generateResetToken', () => {
  it('produces a long, unguessable, URL-safe token', () => {
    const token = generateResetToken();
    // 32 random bytes, base64url — no padding, no characters that need
    // escaping in a query string.
    expect(token.length).toBeGreaterThanOrEqual(32);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('produces a different token every time', () => {
    const tokens = new Set(Array.from({ length: 50 }, () => generateResetToken()));
    expect(tokens.size).toBe(50);
  });
});

describe('hashResetToken', () => {
  it('is deterministic, so the same token always finds its row', () => {
    expect(hashResetToken('abc')).toBe(hashResetToken('abc'));
  });

  it('produces a different hash for a different token', () => {
    expect(hashResetToken('abc')).not.toBe(hashResetToken('abd'));
  });

  it('is a 64-character hex digest (SHA-256)', () => {
    expect(hashResetToken('abc')).toMatch(/^[0-9a-f]{64}$/);
  });
});
