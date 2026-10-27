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
 *  - the page size and the offset reach MySQL's LIMIT as whole numbers.
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

  it('hands MySQL whole numbers for the page size and the offset', async () => {
    await listAdminMcpTokens({ limit: 1.5, offset: 2.9 });
    const params = rowsQuery().params;
    expect(params).toContain(1);
    expect(params).toContain(2);
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
      '(SELECT COUNT(*) FROM mcp_tokens WHERE revoked_at IS NOT NULL) AS revoked',
    );
    // The account is looked at exactly twice: the usable bucket and the
    // disabled one.
    expect(sql.match(/disabled_at/g) ?? []).toHaveLength(2);
  });
});
