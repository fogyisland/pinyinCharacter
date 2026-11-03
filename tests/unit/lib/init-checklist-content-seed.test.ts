/**
 * lib/init-checklist.ts — the 14th step, "content seed ready".
 *
 * The HSK step (13) covers the one dataset whose absence breaks a whole
 * feature area silently. Step 14 covers the rest: the rare chars, the
 * etymology rows, the poems, the classics and the sutras. A server can
 * answer 404 for a classic that was never imported while every other
 * check is green — the same failure class as the HSK one, one dataset
 * over.
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

vi.mock('@/lib/seed-runner', () => ({
  readSeedCounts: vi.fn(),
}));

import { getPool } from '@/lib/db';
import { getRuntimeSiteUrl } from '@/lib/seo/config';
import { readSeedCounts } from '@/lib/seed-runner';
import { runInitChecks, type InitReport, type CheckResult } from '@/lib/init-checklist';
import { SEED_DATASETS } from '@/lib/seed-registry';

/** Set NODE_ENV for the duration of a test. */
function setNodeEnv(value: string): void {
  vi.stubEnv('NODE_ENV', value);
}

/** The counts the mocked seed runner reports. */
let counts: Record<string, number> = {};

/** Find a step in a report by its id. */
function step(report: InitReport, id: string): CheckResult | undefined {
  return report.steps.find((s) => s.id === id);
}

beforeEach(() => {
  counts = {};
  // Every dataset complete unless a test says otherwise.
  for (const dataset of SEED_DATASETS) counts[dataset.id] = dataset.expected;

  const pool = {
    query: vi.fn(async (sql: string) => {
      if (sql.includes('information_schema.TABLES')) return [[{ n: 22 }], []];
      if (sql.includes('COUNT(*) AS total, COUNT(hsk_level)')) {
        return [[{ total: 8105, graded: 8105 }], []];
      }
      if (sql.includes('is_admin = 1')) return [[{ n: 1 }], []];
      if (sql.includes('COUNT(*) AS n FROM users')) return [[{ n: 1 }], []];
      if (sql.includes('SELECT 1')) return [[{ ok: 1 }], []];
      return [[], []];
    }),
  };
  vi.mocked(getPool).mockReturnValue(pool as never);
  vi.mocked(getRuntimeSiteUrl).mockResolvedValue('https://example.com');
  vi.mocked(readSeedCounts).mockImplementation(async () => ({ ...counts }));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('init checklist — the content seed step', () => {
  it('has a step for the content seed', async () => {
    const report = await runInitChecks();
    expect(step(report, 'content-seed')).toBeDefined();
  });

  it('is green when every dataset holds the expected rows', async () => {
    setNodeEnv('production');
    const report = await runInitChecks();
    expect(step(report, 'content-seed')!.status).toBe('ok');
  });

  it('is RED in production when a dataset is missing rows', async () => {
    setNodeEnv('production');
    // The classics were never imported — /ancient would be empty.
    counts['classics'] = 0;

    const report = await runInitChecks();

    const contentStep = step(report, 'content-seed')!;
    expect(contentStep.status).toBe('fail');
    expect(contentStep.details).toContain('古籍');
  });

  it('is only a warning in development', async () => {
    setNodeEnv('development');
    counts['classics'] = 0;

    const report = await runInitChecks();

    expect(step(report, 'content-seed')!.status).toBe('warn');
  });

  it('names every incomplete dataset, not just the first', async () => {
    setNodeEnv('production');
    counts['classics'] = 0;
    counts['poems'] = 12;

    const report = await runInitChecks();

    const details = step(report, 'content-seed')!.details ?? '';
    expect(details).toContain('古籍');
    expect(details).toContain('诗词');
  });

  it('points at the import screen', async () => {
    setNodeEnv('production');
    counts['classics'] = 0;

    const report = await runInitChecks();

    expect(step(report, 'content-seed')!.fixHref).toBe('/admin/seed');
  });

  it('counts the missing rows', async () => {
    setNodeEnv('production');
    const classics = SEED_DATASETS.find((d) => d.id === 'classics')!;
    counts['classics'] = classics.expected - 5;

    const report = await runInitChecks();

    expect(step(report, 'content-seed')!.details).toContain('5');
  });

  it('treats a dataset with MORE rows than expected as complete', async () => {
    setNodeEnv('production');
    // An operator added rows by hand — the seed must not call that a
    // failure, and it must not delete them either.
    counts['classics'] = (SEED_DATASETS.find((d) => d.id === 'classics')!.expected) + 10;

    const report = await runInitChecks();

    expect(step(report, 'content-seed')!.status).toBe('ok');
  });
});
