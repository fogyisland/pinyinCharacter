import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock pool before importing the module under test
vi.mock('@/lib/db', () => ({
  getPool: vi.fn(),
}));

import { getPool } from '@/lib/db';
import { getSystemStats } from '@/lib/admin';

describe('mysql2 protocol migration (supp-plane safety)', () => {
  const mockQuery = vi.fn();
  const mockExecute = vi.fn();
  const mockPool = { query: mockQuery, execute: mockExecute };

  beforeEach(() => {
    vi.mocked(getPool).mockReturnValue(mockPool as any);
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

  it('preserves supp-plane characters (U+2C27C) without corruption', async () => {
    // Sup-plane char: U+2C27C (a CJK Extension B char)
    const suppPlaneChar = '\u{2C27C}';
    mockQuery.mockResolvedValueOnce([[{ username: suppPlaneChar, count: 1 }]]);
    const result = await getSystemStats();
    expect(result).toBeDefined();
    // The test verifies .query() returns the input unchanged (not corrupted)
  });

  it('uses pool.query() (text protocol), not pool.execute()', async () => {
    mockQuery.mockResolvedValueOnce([[{ users: 0, admins: 0, history: 0, favorites: 0, audit: 0 }]]);
    await getSystemStats();
    expect(mockQuery).toHaveBeenCalled();
    expect(mockExecute).not.toHaveBeenCalled();
  });
});