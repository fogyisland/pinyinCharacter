/**
 * scripts/init-db.ts — the "enough counts as seeded" rule.
 *
 * The seeders used to skip whenever the table held any row at all, so a
 * half-finished import stayed half-finished forever: a database with one
 * row was considered complete and never topped up. `isSeededEnough` is the
 * rule that replaced it — a table is complete only when it holds at least
 * as many rows as the repository ships.
 *
 * The database layer is mocked, so these tests need no DB.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

vi.mock('@/lib/db', () => ({
  getPool: vi.fn(),
  closePool: vi.fn(),
}));

vi.mock('@/lib/seed-registry', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/seed-registry')>('@/lib/seed-registry');
  return {
    ...actual,
    getSeedDataset: vi.fn(),
  };
});

import { getPool } from '@/lib/db';
import { getSeedDataset } from '@/lib/seed-registry';
import { initPoems, initSutras, initClassics, initChars } from '@/scripts/init-db';

/** The row count the mocked pool reports for any table. */
let tableCount = 0;

/** The expected size the mocked registry reports. */
let expected = 100;

beforeEach(() => {
  tableCount = 0;
  expected = 100;

  const pool = {
    query: vi.fn(async (sql: string) => {
      if (sql.includes('COUNT(*)')) return [[{ count: tableCount }], []];
      return [{ affectedRows: 0 }, []];
    }),
    getConnection: vi.fn(),
  };
  vi.mocked(getPool).mockReturnValue(pool as never);
  vi.mocked(getSeedDataset).mockImplementation(
    (id: string) =>
      ({
        id,
        label: id,
        table: id,
        dependsOn: '',
        expected,
        countSource: 'json',
        strategy: 'auto',
        kind: 'rows',
        manualCommand: 'npm run seed:run',
      }) as never,
  );
});

describe('init-db — "enough counts as seeded"', () => {
  it('skips a table that already holds the full expected set', async () => {
    tableCount = 100;

    const result = await initPoems();

    expect(result.skipped).toBe(true);
    expect(result.inserted).toBe(0);
  });

  it('does NOT skip a table that holds only part of the expected set', async () => {
    // 40 of 100 rows — the state a half-finished import leaves. The old
    // rule skipped here, which is why partial imports stayed partial.
    tableCount = 40;

    const result = await initPoems();

    expect(result.skipped).not.toBe(true);
  });

  it('does NOT skip a table that is one row short of the expected set', async () => {
    tableCount = 99;

    const result = await initPoems();

    expect(result.skipped).not.toBe(true);
  });

  it('leaves a table that holds MORE than the expected set alone', async () => {
    // An operator may have added rows by hand; the seed must not delete
    // them, and it must not re-seed either.
    tableCount = 250;

    const result = await initPoems();

    expect(result.skipped).toBe(true);
    expect(result.inserted).toBe(0);
  });

  it('applies the same rule to every table it seeds', async () => {
    tableCount = 10;
    expected = 100;

    for (const seed of [initPoems, initSutras, initClassics, initChars]) {
      const result = await seed();
      expect(result.skipped, `${seed.name} skipped a partial table`).not.toBe(true);
    }
  });
});
