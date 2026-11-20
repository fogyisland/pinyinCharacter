/**
 * lib/init-checklist.ts — the required-tables step.
 *
 * The step used to compare a hand-written table count
 * (`EXPECTED_TABLES = 22`) against `COUNT(*) FROM information_schema.
 * tables`. That is the wrong shape for the question, in two ways:
 *
 *  1. **A count cannot name what is missing.** "21 / 22" leaves the
 *     operator to diff the schema by hand against forty-odd tables.
 *  2. **A missing column does not move the count at all.** A `chars`
 *     table without `hsk_level` keeps the count where it was, so the
 *     step stayed green while `/game` answered 404 on every tier.
 *
 * The count was also a hand-written number next to a repository that
 * creates tables in two places — the base DDL in `scripts/init-db.ts`
 * and the incremental `scripts/migrations/*.sql`. A hand-written count
 * next to a moving target drifts, and a drifted count reports tables
 * that were never supposed to exist.
 *
 * So the step now compares **per table and per column**, against the
 * expectation derived from the repository itself, and names what is
 * missing.
 *
 * The database layer is mocked, so the test needs no DB.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('server-only', () => ({}));

vi.mock('@/lib/db', () => ({
  getPool: vi.fn(),
}));

vi.mock('@/lib/seo/config', () => ({
  getRuntimeSiteUrl: vi.fn(),
}));

vi.mock('@/lib/schema-check', () => ({
  compareSchema: vi.fn(),
}));

import { getPool } from '@/lib/db';
import { getRuntimeSiteUrl } from '@/lib/seo/config';
import { compareSchema } from '@/lib/schema-check';
import { runInitChecks } from '@/lib/init-checklist';

const UP_TO_DATE = {
  missingTables: [],
  missingColumns: [],
  actualTables: 40,
  expectedTables: 40,
  actualColumns: 300,
  expectedColumns: 300,
  upToDate: true,
};

/** The rows the mocked pool returns, keyed by a substring of the SQL. */
function rowsFor(sql: string): unknown[] {
  if (sql.includes('information_schema.TABLES')) {
    return [{ n: 22 }];
  }
  if (sql.includes('COUNT(hsk_level)')) {
    return [{ total: 7909, graded: 7909 }];
  }
  if (sql.includes('is_admin = 1')) {
    return [{ id: 1, username: 'admin', created_at: new Date('2026-01-01') }];
  }
  if (sql.includes('SELECT 1 AS ok')) {
    return [{ ok: 1 }];
  }
  return [];
}

/** The step with the given id. */
async function step(id: string) {
  const report = await runInitChecks();
  const found = report.steps.find((s) => s.id === id);
  if (!found) throw new Error(`no step with id "${id}"`);
  return found;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getPool).mockReturnValue({
    query: vi.fn(async (sql: string) => [rowsFor(sql)]),
  } as never);
  vi.mocked(getRuntimeSiteUrl).mockResolvedValue('https://ziyun.pudafo.com');
  vi.mocked(compareSchema).mockResolvedValue(UP_TO_DATE);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the required-tables step', () => {
  it('is present in the checklist', async () => {
    const found = await step('db-tables');
    expect(found.name).toBe('必需表');
  });

  it('is green when the schema matches the expectation', async () => {
    const found = await step('db-tables');
    expect(found.status).toBe('ok');
  });

  it('names the table that is missing', async () => {
    vi.mocked(compareSchema).mockResolvedValue({
      ...UP_TO_DATE,
      upToDate: false,
      missingTables: [{ table: 'idioms', source: 'scripts/migrations/2026-11-19-idioms.sql' }],
    });
    const found = await step('db-tables');
    expect(found.status).toBe('fail');
    // The operator has to know WHICH table, not just that a number is
    // small.
    expect(found.details).toContain('idioms');
  });

  it('names the column that is missing', async () => {
    // The case a table count can never see: the table is there, the
    // column is not, and the count does not move.
    vi.mocked(compareSchema).mockResolvedValue({
      ...UP_TO_DATE,
      upToDate: false,
      missingColumns: [
        { table: 'chars', column: 'hsk_level', source: 'scripts/migrations/2026-07-04-hsk-level.sql' },
      ],
    });
    const found = await step('db-tables');
    expect(found.status).toBe('fail');
    expect(found.details).toContain('chars.hsk_level');
  });

  it('does not report a missing table as a missing column too', async () => {
    vi.mocked(compareSchema).mockResolvedValue({
      ...UP_TO_DATE,
      upToDate: false,
      missingTables: [{ table: 'idioms', source: 'scripts/migrations/a.sql' }],
      missingColumns: [{ table: 'idioms', column: 'word', source: 'scripts/migrations/a.sql' }],
    });
    const found = await step('db-tables');
    expect(found.details).toContain('idioms');
    expect(found.details).not.toContain('idioms.word');
  });

  it('points at the screen that fixes it', async () => {
    vi.mocked(compareSchema).mockResolvedValue({
      ...UP_TO_DATE,
      upToDate: false,
      missingTables: [{ table: 'idioms', source: 'scripts/migrations/a.sql' }],
    });
    const found = await step('db-tables');
    expect(found.fixHref).toBe('/admin/seed');
  });

  it('does not claim the schema is fine when the probe failed', async () => {
    // "We cannot find out" is not "it is fine". A failed probe must
    // not be reported as a pass — that is the failure mode the whole
    // check exists to prevent.
    vi.mocked(compareSchema).mockRejectedValue(new Error('ER_NO_SUCH_TABLE'));
    const found = await step('db-tables');
    expect(found.status).not.toBe('ok');
    expect(found.details).toContain('无法读取');
  });
});
