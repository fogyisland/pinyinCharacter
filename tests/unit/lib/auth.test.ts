/**
 * Unit tests for lib/auth.ts. The pool and the cookie jar are mocked so
 * we can assert the number of DB round-trips each helper costs.
 *
 * The point of the suite: getCurrentUser() and getCurrentUserWithAdmin()
 * must each cost exactly ONE query. The admin layout and the page it
 * renders both resolve the session, and a second query per call used to
 * make every admin page render four times around the users table.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const cookieStore = new Map<string, string>();

/** One row of the users table, as the auth queries read it. */
interface UserRow {
  is_admin: number;
  disabled_at: Date | null;
}

let userRows: UserRow[] = [];
let queryLog: Array<{ sql: string; params: unknown[] }> = [];

vi.mock('next/headers', () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) =>
        cookieStore.has(name) ? { name, value: cookieStore.get(name)! } : undefined,
    }),
}));

vi.mock('jsonwebtoken', () => ({
  default: {
    verify: vi.fn(() => ({ userId: 7, username: 'tester' })),
    sign: vi.fn(() => 'header.payload.signature'),
  },
}));

vi.mock('@/lib/db', () => ({
  getPool: () => ({
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      queryLog.push({ sql, params });
      return [userRows, []];
    }),
  }),
}));

import jwt from 'jsonwebtoken';
import { getCurrentUser, getCurrentUserWithAdmin, requireAdmin, signSession } from '@/lib/auth';

beforeEach(() => {
  // getSecret() reads the env at call time and throws below 32 chars.
  process.env.JWT_SECRET = 'test-secret-for-the-auth-unit-tests-0123456789';
  cookieStore.clear();
  queryLog = [];
  userRows = [];
  cookieStore.set('auth_token', 'header.payload.signature');
});

describe('getCurrentUser', () => {
  it('resolves the session with a single query', async () => {
    userRows = [{ is_admin: 0, disabled_at: null }];
    const user = await getCurrentUser();
    expect(user).toEqual({ id: 7, username: 'tester' });
    expect(queryLog).toHaveLength(1);
    expect(queryLog[0]!.sql).toContain('FROM users WHERE id = ?');
  });

  it('returns null when the account was disabled', async () => {
    userRows = [{ is_admin: 1, disabled_at: new Date() }];
    expect(await getCurrentUser()).toBeNull();
  });

  it('returns null when the row is gone', async () => {
    userRows = [];
    expect(await getCurrentUser()).toBeNull();
  });

  it('returns null without a session cookie', async () => {
    cookieStore.clear();
    expect(await getCurrentUser()).toBeNull();
    expect(queryLog).toHaveLength(0);
  });
});

describe('getCurrentUserWithAdmin', () => {
  it('resolves the session with a single query (it used to take two)', async () => {
    userRows = [{ is_admin: 1, disabled_at: null }];
    const user = await getCurrentUserWithAdmin();
    expect(user).toEqual({ id: 7, username: 'tester', isAdmin: true });
    expect(queryLog).toHaveLength(1);
  });

  it('reports isAdmin=false for a regular account', async () => {
    userRows = [{ is_admin: 0, disabled_at: null }];
    const user = await getCurrentUserWithAdmin();
    expect(user?.isAdmin).toBe(false);
  });
});

describe('the session token', () => {
  it('carries the user id and the name and nothing else', async () => {
    // Admin rights are deliberately NOT in the token: they are read from
    // the users table on every request, so demoting an administrator takes
    // effect at once instead of at token expiry.
    //
    // The corollary is the trap this suite once fell into: a route that
    // asks the token payload for `isAdmin` gets `undefined` and refuses
    // everybody, administrator included. The token's payload is pinned here
    // so that a route reading rights off it fails this test rather than
    // the browser.
    await signSession({ id: 7, username: 'tester' });
    expect(vi.mocked(jwt.sign)).toHaveBeenCalledWith(
      { userId: 7, username: 'tester' },
      expect.any(String),
      expect.objectContaining({ algorithm: 'HS256' }),
    );
  });
});

describe('requireAdmin', () => {
  it('allows an admin through', async () => {
    userRows = [{ is_admin: 1, disabled_at: null }];
    const auth = await requireAdmin();
    expect(auth.ok).toBe(true);
    if (auth.ok) expect(auth.user.isAdmin).toBe(true);
  });

  it('rejects a regular account with 403', async () => {
    userRows = [{ is_admin: 0, disabled_at: null }];
    const auth = await requireAdmin();
    expect(auth.ok).toBe(false);
    if (!auth.ok) {
      expect(auth.reason).toBe('forbidden');
      expect(auth.response.status).toBe(403);
    }
  });

  it('rejects a signed-out visitor with 401', async () => {
    cookieStore.clear();
    const auth = await requireAdmin();
    expect(auth.ok).toBe(false);
    if (!auth.ok) {
      expect(auth.reason).toBe('unauthenticated');
      expect(auth.response.status).toBe(401);
    }
  });
});
