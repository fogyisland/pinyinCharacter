/**
 * Unit tests for lib/mcp-token-admin.ts.
 *
 * The pool is mocked the way the other admin libraries are mocked: every
 * query is logged, and the answer is keyed off a substring of the SQL.
 * That is enough to pin the three things the admin page depends on and
 * that a reader cannot see in the markup:
 *
 *  - the three token buckets partition the holders, and the counters agree
 *    with the filters (a chip that counts 3 while it lists 2 rows is a
 *    lie the operator has to notice);
 *  - a search term is a literal — `%` and `_` are wildcards in a LIKE,
 *    so a search for `%` would otherwise list every holder;
 *  - the page size and the offset reach MySQL's LIMIT as whole numbers;
 *  - a row's state says the same thing as its badge: a token of a
 *    disabled account is not active, because `resolveToken()` refuses it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let queryLog: Array<{ sql: string; params: unknown[] }> = [];
let queryResults: Record<string, unknown[]> = {};

vi.mock('@/lib/db', () => ({
  getPool: () => ({
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      queryLog.push({ sql, params });
      for (const key of Object.keys(queryResults)) {
        if (sql.includes(key)) return queryResults[key];
      }
      return [[]];
    }),
  }),
}));

import { getAdminMcpTokenStats, listAdminMcpTokens } from '@/lib/mcp-token-admin';

beforeEach(() => {
  queryLog = [];
  queryResults = {};
});

/** The query that fetched the token rows. */
function rowsQuery() {
  return queryLog.find((q) => q.sql.includes('SELECT t.user_id'))!;
}

/** The query that counted the rows. */
function countQuery() {
  return queryLog.find((q) => q.sql.includes('COUNT(*) AS n'))!;
}

describe('listAdminMcpTokens', () => {
  it('lists the usable tokens only, when the filter asks for them', async () => {
    await listAdminMcpTokens({ state: 'active' });
    expect(rowsQuery().sql).toContain('t.revoked_at IS NULL AND u.disabled_at IS NULL');
    expect(countQuery().sql).toContain('t.revoked_at IS NULL AND u.disabled_at IS NULL');
  });

  it('lists the tokens of the disabled accounts on their own filter', async () => {
    await listAdminMcpTokens({ state: 'disabled' });
    expect(rowsQuery().sql).toContain('t.revoked_at IS NULL AND u.disabled_at IS NOT NULL');
  });

  it('lists the revoked tokens on their own filter', async () => {
    await listAdminMcpTokens({ state: 'revoked' });
    expect(rowsQuery().sql).toContain('t.revoked_at IS NOT NULL');
  });

  it('searches for the search term literally', async () => {
    await listAdminMcpTokens({ q: 'a%b_c' });
    const query = rowsQuery();
    expect(query.sql).toContain("u.username LIKE ? ESCAPE '!'");
    // `%` and `_` are wildcards in a LIKE — without the escape they would
    // match any username.
    expect(query.params).toContain('%a!%b!_c%');
  });

  it('escapes the escape character itself', async () => {
    await listAdminMcpTokens({ q: 'a!b' });
    expect(rowsQuery().params).toContain('%a!!b%');
  });

  it('falls back to the default when the page size is not a whole number', async () => {
    // MySQL's LIMIT takes whole numbers — a fractional one is a syntax
    // error there. The route falls back to the default for the same
    // reason, so the two layers answer the same way.
    await listAdminMcpTokens({ limit: 1.5, offset: 2.9 });
    const params = rowsQuery().params;
    expect(params).toContain(50);
    expect(params).toContain(0);
    expect(params.every((p) => typeof p !== 'number' || Number.isInteger(p))).toBe(true);
  });

  it('clamps the page size into the range the database is asked for', async () => {
    await listAdminMcpTokens({ limit: 5000 });
    expect(rowsQuery().params).toContain(200);
  });

  it('never asks for a negative offset', async () => {
    await listAdminMcpTokens({ offset: -10 });
    expect(rowsQuery().params).toContain(0);
  });
});

describe('the state of a token', () => {
  /** The rows the mocked pool answers the list query with. */
  function rowWith(disabled: boolean, revoked: boolean): Record<string, unknown> {
    return {
      user_id: 7,
      username: 'tester',
      is_admin: 0,
      disabled_epoch: disabled ? 1780000000 : null,
      created_epoch: 1780000000,
      last_used_epoch: null,
      revoked_epoch: revoked ? 1780000001 : null,
    };
  }

  it('calls a token of a living account active', async () => {
    queryResults['SELECT t.user_id'] = [[rowWith(false, false)]];
    const { items } = await listAdminMcpTokens({});
    expect(items[0]!.state).toBe('active');
    expect(items[0]!.disabled).toBe(false);
  });

  it('calls a token of a disabled account disabled, not active', async () => {
    // `resolveToken()` refuses this token, so calling it active would
    // tell a machine reader that it works when it does not.
    queryResults['SELECT t.user_id'] = [[rowWith(true, false)]];
    const { items } = await listAdminMcpTokens({});
    expect(items[0]!.state).toBe('disabled');
    expect(items[0]!.disabled).toBe(true);
  });

  it('calls a revoked token revoked, even for a disabled account', async () => {
    queryResults['SELECT t.user_id'] = [[rowWith(true, true)]];
    const { items } = await listAdminMcpTokens({});
    expect(items[0]!.state).toBe('revoked');
  });
});

describe('getAdminMcpTokenStats', () => {
  it('counts the three buckets apart from one another', async () => {
    await getAdminMcpTokenStats();
    const sql = queryLog[0]!.sql;
    expect(sql).toContain('AS active');
    expect(sql).toContain('AS disabled');
    expect(sql).toContain('AS revoked');
    // The usable bucket is the one `resolveToken()` accepts.
    expect(sql).toContain('t.revoked_at IS NULL');
    expect(sql).toContain('u.disabled_at IS NULL');
    expect(sql).toContain('u.disabled_at IS NOT NULL');
  });

  it('counts a revoked token as revoked, even for a disabled account', async () => {
    await getAdminMcpTokenStats();
    const sql = queryLog[0]!.sql;
    // The revoked bucket does not look at the account at all.
    expect(sql).toContain(
      'SUM(CASE WHEN t.revoked_at IS NOT NULL THEN 1 ELSE 0 END), 0) AS revoked',
    );
    // The account is looked at exactly twice: the usable bucket and the
    // disabled one.
    expect(sql.match(/disabled_at/g) ?? []).toHaveLength(2);
  });

  it('counts the tokens the search selects, not the whole table', async () => {
    // A chip that counts the whole table while the list below it shows
    // the search answers a question the operator did not ask.
    await getAdminMcpTokenStats('alice');
    const query = queryLog[0]!;
    expect(query.sql).toContain("u.username LIKE ? ESCAPE '!'");
    expect(query.params).toContain('%alice%');
    // The registered users are counted with the same term.
    expect(query.sql).toContain("u0.username LIKE ? ESCAPE '!'");
  });

  it('counts every token holder when there is no search', async () => {
    await getAdminMcpTokenStats();
    const query = queryLog[0]!;
    expect(query.sql).not.toContain('username LIKE');
    expect(query.params).toHaveLength(0);
  });
});
