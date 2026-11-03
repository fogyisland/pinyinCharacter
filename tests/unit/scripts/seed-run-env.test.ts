/**
 * scripts/seed-run.ts — the DATABASE_URL pre-check.
 *
 * npm does NOT read `.env`; only Next.js does, at boot. So a script run
 * from a shell sees no DATABASE_URL and every dataset fails with the same
 * "DATABASE_URL is not set" — which reads like seven independent failures
 * rather than one missing environment variable.
 *
 * The pre-check reports the cause once and says how to fix it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('server-only', () => ({}));

const readSeedCounts = vi.fn();
const runSeedDataset = vi.fn();

vi.mock('@/lib/seed-runner', () => ({
  readSeedCounts: (...args: unknown[]) => readSeedCounts(...args),
  runSeedDataset: (...args: unknown[]) => runSeedDataset(...args),
}));

vi.mock('@/lib/db', () => ({
  getPool: vi.fn(),
  closePool: vi.fn(),
}));

import { SEED_DATASETS } from '@/lib/seed-registry';

/** Capture what the script writes to stdout/stderr. */
let out: string[] = [];
let err: string[] = [];
let originalLog: typeof console.log;
let originalError: typeof console.error;

/** The DATABASE_URL the mocked environment provides. */
let databaseUrl: string | undefined;

/** Run the script's main() with the given argv. */
async function runMain(_argv: string[]): Promise<void> {
  process.env.DATABASE_URL = databaseUrl ?? '';
  if (databaseUrl === undefined) delete process.env.DATABASE_URL;

  const seedRunModule = await import('@/scripts/seed-run');
  const main = (seedRunModule as unknown as { main?: () => Promise<void> }).main;
  expect(typeof main, 'seed-run must export main()').toBe('function');
  await main!();
}

beforeEach(() => {
  out = [];
  err = [];
  databaseUrl = undefined;
  readSeedCounts.mockReset();
  runSeedDataset.mockReset();
  readSeedCounts.mockResolvedValue(
    Object.fromEntries(SEED_DATASETS.map((d) => [d.id, d.expected])),
  );
  runSeedDataset.mockResolvedValue({
    datasetId: 'hsk-grading',
    status: 'ok',
    actual: 2632,
    inserted: 0,
  });

  originalLog = console.log;
  originalError = console.error;
  console.log = (...parts: unknown[]) => out.push(parts.join(' '));
  console.error = (...parts: unknown[]) => err.push(parts.join(' '));
});

afterEach(() => {
  console.log = originalLog;
  console.error = originalError;
  delete process.env.DATABASE_URL;
});

describe('seed-run — the DATABASE_URL pre-check', () => {
  it('refuses to run when DATABASE_URL is missing', async () => {
    await runMain([]);

    expect(readSeedCounts).not.toHaveBeenCalled();
    expect(runSeedDataset).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it('says the variable is missing, and does not blame the data', async () => {
    await runMain([]);

    const message = err.join('\n');
    expect(message).toContain('DATABASE_URL');
    expect(message).not.toContain('hsk-grading');
  });

  it('gives a command that loads the env file', async () => {
    await runMain([]);

    const message = err.join('\n');
    // The fix has to be copy-pasteable and has to name the flag that
    // makes npm/tsx read the file at all.
    expect(message).toContain('--env-file=.env');
  });

  it('explains that npm does not read .env', async () => {
    await runMain([]);

    // Without this the operator retries `npm run seed:run` and gets the
    // same error, because the flag is already in package.json.
    const message = err.join('\n');
    expect(message.toLowerCase()).toContain('npm');
    expect(message).toContain('.env');
  });

  it('runs normally when DATABASE_URL is present', async () => {
    databaseUrl = 'mysql://user:pw@127.0.0.1:3306/ziyun';

    await runMain([]);

    expect(readSeedCounts).toHaveBeenCalled();
    expect(runSeedDataset).toHaveBeenCalled();
    expect(err.join('\n')).not.toContain('DATABASE_URL is not set');
  });

  it('does not write the database URL into the message', async () => {
    databaseUrl = 'mysql://user:sup3rsecret@127.0.0.1:3306/ziyun';

    await runMain([]);

    const message = err.join('\n') + out.join('\n');
    expect(message).not.toContain('sup3rsecret');
  });
});
