/**
 * lib/init-checklist.ts — the HSK grading step.
 *
 * 2026-11-03 (R-228): the production server answered 404 on every /game
 * level and 503 on every round, because `chars.hsk_level` had never been
 * filled — `scripts/import-hsk.ts` is a deployment script, not a
 * migration, so nothing runs it automatically. Every OTHER checklist step
 * was green, because the connection worked, the tables existed and the
 * admin user was there. The checklist said "ready" while the games area
 * was dead.
 *
 * This step is what makes that failure visible in the admin panel instead
 * of in a learner's browser.
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

import { getPool } from '@/lib/db';
import { getRuntimeSiteUrl } from '@/lib/seo/config';
import { runInitChecks } from '@/lib/init-checklist';

/**
 * The rows the mocked pool returns, keyed by a substring of the SQL.
 *
 * The checklist runs several queries; each is answered from this map. A
 * query with no entry returns an empty result, which the checklist treats
 * as "the read failed" (its `safeQuery` contract).
 */
function rowsFor(sql: string): unknown[] {
  if (sql.includes('information_schema.TABLES')) {
    return [{ n: 22 }];
  }
  if (sql.includes('COUNT(*) AS total, COUNT(hsk_level) AS graded')) {
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

/** The HSK coverage the mocked pool reports. */
function mockHskCoverage(graded: number, total = 7909) {
  vi.mocked(getPool).mockReturnValue({
    query: vi.fn(async (sql: string) => [
      sql.includes('COUNT(hsk_level)') ? [{ total, graded }] : rowsFor(sql),
    ]),
  } as never);
}

/**
 * Set NODE_ENV for the duration of a test.
 *
 * `process.env.NODE_ENV` is typed as readonly (Node's own types treat it
 * as a constant), so the assignment has to go through `vi.stubEnv` — which
 * also restores the original value when the test ends.
 */
function setNodeEnv(value: string) {
  vi.stubEnv('NODE_ENV', value);
}

beforeEach(() => {
  vi.clearAllMocks();
  // The checklist's step severity depends on the environment: a missing
  // grading is a FAILURE in production and only a warning in development.
  // The production case is the one that matters, so that is the default.
  setNodeEnv('production');
  vi.mocked(getPool).mockReturnValue({
    query: vi.fn(async (sql: string) => [rowsFor(sql)]),
  } as never);
  vi.mocked(getRuntimeSiteUrl).mockResolvedValue('https://ziyun.pudafo.com');
});

afterEach(() => {
  // `vi.unstubAllEnvs` restores every value `vi.stubEnv` changed, including
  // NODE_ENV — the original value is captured by vitest, so the checklist
  // sees the real environment again after the suite.
  vi.unstubAllEnvs();
});

describe('the HSK grading step', () => {
  it('is present in the checklist', async () => {
    const found = await step('hsk-grading');
    expect(found.name).toBe('HSK 分级数据');
  });

  it('is green when every char carries a grade', async () => {
    const found = await step('hsk-grading');
    expect(found.status).toBe('ok');
    expect(found.details).toContain('7909');
  });

  it('is RED when the grading was never imported', async () => {
    // The production shape: 7909 chars, ZERO of them graded.
    mockHskCoverage(0);
    const found = await step('hsk-grading');
    expect(found.status).toBe('fail');
    expect(found.details).toContain('未导入');
  });

  it('says what breaks when it is red', async () => {
    mockHskCoverage(0);
    const found = await step('hsk-grading');
    // The operator has to know WHICH feature is dead, not just that a
    // number is small.
    expect(found.details).toContain('/game');
  });

  it('is red when only PART of the vocabulary is graded', async () => {
    // A partial import — the vocabulary is 2632 chars, so 1000 is not a
    // complete run. Every HSK tier would be broken.
    mockHskCoverage(1000);
    const found = await step('hsk-grading');
    expect(found.status).toBe('fail');
  });

  it('warns instead of failing in development', async () => {
    mockHskCoverage(0);
    setNodeEnv('development');
    const found = await step('hsk-grading');
    expect(found.status).toBe('warn');
  });

  it('reports the counts in the context', async () => {
    const report = await runInitChecks();
    expect(report.context.hskGraded).toBe(7909);
    expect(report.context.hskTotal).toBe(7909);
    expect(report.context.hskExpected).toBe(2632);
  });
});
