/**
 * The session guard must survive an unreachable database.
 *
 * `resolveSessionUser()` reads the `users` table to learn `is_admin` and
 * `disabled_at` — the two flags a JWT must not carry, because a demotion or
 * a ban has to take effect immediately. That query had no try/catch, so a
 * database blip turned EVERY admin page into a 500:
 *
 *   - the browser only saw "An error occurred in the Server Components
 *     render" (production builds strip the message), and
 *   - the page whose whole job is to CONFIGURE the site URL was unreachable
 *     exactly when the database was down.
 *
 * The database being unreachable is not "this user is not an admin" and not
 * "this user is not logged in" — it is "we cannot answer right now". The
 * guard has to answer *safely* in that case: treat it as unauthenticated,
 * so the visitor is sent to the login screen instead of seeing a stack
 * trace, and no protected page renders.
 *
 * ⚠️ The failure here must NOT be "logged in as nobody": the guard has to
 * refuse, not grant.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const cookieStore = new Map<string, string>();

/** Set by each test: the rows the users query returns, or a thrown error. */
let queryResult:
  | { rows: Array<{ is_admin: number; disabled_at: Date | null }> }
  | { error: Error } = { rows: [] };

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
    query: vi.fn(async () => {
      if ('error' in queryResult) throw queryResult.error;
      return [queryResult.rows, []];
    }),
  }),
}));

import { requireAdmin, getCurrentUserWithAdmin } from '@/lib/auth';

const SESSION_COOKIE = 'auth_token';

beforeEach(() => {
  // `getSecret()` reads the env at call time and throws below 32 chars —
  // and it is evaluated as an ARGUMENT to the mocked `jwt.verify`, so
  // without it the session never resolves and the query never runs.
  process.env.JWT_SECRET = 'test-secret-for-the-auth-unit-tests-0123456789';
  cookieStore.clear();
  cookieStore.set(SESSION_COOKIE, 'header.payload.signature');
  queryResult = { rows: [{ is_admin: 1, disabled_at: null }] };
});

describe('the guard when the database cannot be reached', () => {
  it('does not throw — it answers "not logged in"', async () => {
    queryResult = { error: new Error('ECONNREFUSED 127.0.0.1:3306') };

    // Before the fix this rejected with the raw driver error, which the
    // page could not survive: the render failed instead of redirecting.
    await expect(requireAdmin()).resolves.toBeDefined();
  });

  it('refuses the request instead of granting it', async () => {
    queryResult = { error: new Error('ECONNREFUSED 127.0.0.1:3306') };

    const result = await requireAdmin();

    // ⚠️ The safe answer. "We cannot check" must never become "you are an
    // admin" — and it must not become a 500 either.
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('unauthenticated');
      expect(result.response.status).toBe(401);
    }
  });

  it('reports no user rather than a broken session', async () => {
    queryResult = { error: new Error('ECONNREFUSED 127.0.0.1:3306') };

    await expect(getCurrentUserWithAdmin()).resolves.toBeNull();
  });

  it('says out loud that the database is the reason', async () => {
    // Failing closed is only safe if the failure is not silent. A swallowed
    // error would make "the database is down" indistinguishable from
    // "the session is gone", and the operator would chase the wrong thing.
    const errors: unknown[][] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args);
    });
    queryResult = { error: new Error('ECONNREFUSED 127.0.0.1:3306') };

    try {
      await requireAdmin();
    } finally {
      spy.mockRestore();
    }

    expect(errors.length).toBeGreaterThan(0);
    expect(String(errors[0][0])).toContain('[auth]');
    expect(String(errors[0][0])).toContain('could not be read');
  });

  it('still answers normally when the database IS reachable', async () => {
    const result = await requireAdmin();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.user.id).toBe(7);
      expect(result.user.isAdmin).toBe(true);
    }
  });

  it('does not log anything when the database is reachable', async () => {
    // The opposite direction: the failure path must be the loud one, and
    // the healthy path must stay quiet.
    const errors: unknown[][] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args);
    });

    try {
      await requireAdmin();
    } finally {
      spy.mockRestore();
    }

    expect(errors.length).toBe(0);
  });
});
