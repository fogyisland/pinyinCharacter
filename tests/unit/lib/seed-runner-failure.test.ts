/**
 * lib/seed-runner.ts — a failing seeder must be reported as a failure.
 *
 * The seeders in `scripts/init-db.ts` catch their own errors so one
 * broken import does not stop the boot path. That means a seeder can
 * return "inserted 0, failed: <reason>" instead of throwing.
 *
 * The runner used to read only the `inserted` field and threw the
 * `failed` field away, so a seeder that inserted nothing was reported
 * as a SUCCESS — the gap looked closed while the table was still empty.
 * That is exactly what a production server looked like: every dataset
 * at zero, and the seed run reporting nothing wrong.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

vi.mock('@/lib/db', () => ({
  getPool: vi.fn(),
  closePool: vi.fn(),
}));

/** What the mocked `initChars` returns. */
let initCharsResult: { inserted: number; skipped: boolean; failed?: string } = {
  inserted: 0,
  skipped: false,
};

/** Whether the mocked `initChars` throws instead of returning. */
let initCharsThrows: Error | null = null;

vi.mock('@/scripts/init-db', () => ({
  initChars: vi.fn(async () => {
    if (initCharsThrows) throw initCharsThrows;
    return initCharsResult;
  }),
  initPoems: vi.fn(async () => ({ inserted: 0, skipped: false })),
  initRareChars: vi.fn(async () => ({ scanned: 0, inserted: 0, skipped: false })),
  initCharEtymology: vi.fn(async () => ({ inserted: 0, skipped: false })),
  initClassics: vi.fn(async () => ({ inserted: 0, skipped: false })),
  initSutras: vi.fn(async () => ({ inserted: 0, skipped: false })),
}));

import { getPool } from '@/lib/db';
import { runSeedDataset } from '@/lib/seed-runner';

beforeEach(() => {
  initCharsResult = { inserted: 0, skipped: false };
  initCharsThrows = null;

  const pool = {
    query: vi.fn(async (sql: string) => {
      // The count query: the table is empty.
      if (sql.includes('COUNT(*)')) return [[{ n: 0 }], []];
      return [[], []];
    }),
    getConnection: vi.fn(),
  };
  vi.mocked(getPool).mockReturnValue(pool as never);
});

describe('seed runner — a seeder that failed', () => {
  it('reports the failure instead of a success', async () => {
    initCharsResult = {
      inserted: 0,
      skipped: false,
      failed: "Unknown column 'unicode_codepoint' in 'field list'",
    };

    const outcome = await runSeedDataset('chars');

    expect(outcome.status).toBe('failed');
    expect(outcome.error).toContain('unicode_codepoint');
  });

  it('does not claim the dataset is complete', async () => {
    initCharsResult = { inserted: 0, skipped: false, failed: 'boom' };

    const outcome = await runSeedDataset('chars');

    expect(outcome.status).not.toBe('ok');
    expect(outcome.status).not.toBe('pending');
  });

  it('keeps the reason the seeder gave', async () => {
    // The reason is the whole point: it says which column is missing,
    // and therefore what to run.
    initCharsResult = {
      inserted: 0,
      skipped: false,
      failed: 'ER_BAD_FIELD_ERROR: Unknown column `x`',
    };

    const outcome = await runSeedDataset('chars');

    expect(outcome.error).toContain('ER_BAD_FIELD_ERROR');
  });

  it('reports a seeder that throws', async () => {
    initCharsThrows = new Error('ER_NO_SUCH_TABLE: Table `chars` does not exist');

    const outcome = await runSeedDataset('chars');

    expect(outcome.status).toBe('failed');
    expect(outcome.error).toContain('ER_NO_SUCH_TABLE');
  });

  it('reports success when the seeder really inserted rows', async () => {
    initCharsResult = { inserted: 8105, skipped: false };

    const outcome = await runSeedDataset('chars');

    // The count query is mocked to answer 0, so the dataset still reads
    // as incomplete — but it must NOT read as failed.
    expect(outcome.status).not.toBe('failed');
    expect(outcome.inserted).toBe(8105);
  });
});
