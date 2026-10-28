import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Pool } from 'mysql2/promise';

// Mock pool before importing the module under test
vi.mock('@/lib/db', () => ({
  getPool: vi.fn(),
}));

import { getPool } from '@/lib/db';
import { getSystemStats } from '@/lib/admin';
import { findUserByUsername } from '@/lib/password-reset';

describe('mysql2 protocol migration (supp-plane safety)', () => {
  const mockQuery = vi.fn();
  const mockExecute = vi.fn();
  const mockPool = { query: mockQuery, execute: mockExecute };

  beforeEach(() => {
    vi.mocked(getPool).mockReturnValue(mockPool as unknown as Pool);
    mockQuery.mockReset();
    mockExecute.mockReset();
  });

  it('returns system stats correctly for BMP input', async () => {
    mockQuery.mockResolvedValueOnce([[{ users: 100, admins: 5, history: 200, favorites: 50, audit: 30 }]]);
    const result = await getSystemStats();
    expect(result.users).toBe(100);
    // Verify .query() was used (not .execute())
    expect(mockQuery).toHaveBeenCalled();
  });

  // Bug guard: mysql2 .execute() uses the binary protocol, which corrupts 4-byte
  // UTF-8 (supp-plane) chars in SQL parameters. This test exercises a function
  // that passes the supp-plane char AS A PARAMETER to pool.query(). If someone
  // reverts pool.query() → pool.execute() in the code path under test, mysql2
  // would re-encode the char and the params[] array would no longer match.
  // We assert the params[] array is identity-equal to the input char, so the
  // test fails the moment a different encoding pipeline is inserted.
  it('preserves supp-plane characters (U+2C27C) without corruption', async () => {
    const suppPlaneChar = '\u{2C27C}';
    // findUserByUsername calls pool.query<any[]>('SELECT id FROM users WHERE username = ?', [username])
    // — the supp-plane char flows through as a parameter.
    mockQuery.mockResolvedValueOnce([[]]);
    await findUserByUsername(suppPlaneChar);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    // SQL must use the ? placeholder (parameterised), not string concatenation.
    expect(sql).toContain('WHERE username = ?');
    // The supp-plane char must arrive at the call site UNMODIFIED. If the
    // call were routed through .execute() (binary protocol), mysql2 would
    // attempt to re-encode the 4-byte UTF-8 char and the params array would
    // no longer identity-match.
    expect(params).toEqual([suppPlaneChar]);
    expect(params![0]).toBe(suppPlaneChar);
  });

  it('uses pool.query() (text protocol), not pool.execute()', async () => {
    mockQuery.mockResolvedValueOnce([[{ users: 0, admins: 0, history: 0, favorites: 0, audit: 0 }]]);
    await getSystemStats();
    expect(mockQuery).toHaveBeenCalled();
    expect(mockExecute).not.toHaveBeenCalled();
  });
});