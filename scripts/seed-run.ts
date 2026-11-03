/**
 * Seed runner — seeds any incomplete content dataset, on demand.
 *
 * Two entry points share this file:
 *
 *  - `npm run seed:run` — run from a shell, seeds everything that is
 *    missing and prints a report of what was expected vs. what is there.
 *  - `POST /api/admin/seed` — the admin page calls the same runner, so the
 *    admin screen and the CLI can never disagree about what a dataset means.
 *
 * Options:
 *
 *   --only=<id>      seed one dataset (repeatable, comma-separated)
 *   --dry-run        report what would be seeded, change nothing
 *   --list           list the datasets and their expected sizes, then exit
 *
 * Everything is idempotent: running it twice is the same as running it
 * once, and running it on a complete database does nothing.
 */
import { closePool } from '../lib/db';
import { SEED_DATASETS, type SeedDataset } from '../lib/seed-registry';
import {
  runSeedDataset,
  readSeedCounts,
  type SeedOutcome,
} from '../lib/seed-runner';

export interface SeedRunOptions {
  /** Dataset ids to seed. Empty means "all of them". */
  only: string[];
  /** Report what would happen without writing anything. */
  dryRun: boolean;
}

export interface SeedRunReport {
  dryRun: boolean;
  outcomes: Array<SeedOutcome & { dataset: SeedDataset }>;
  /** Wall-clock milliseconds the run took. */
  elapsedMs: number;
}

/**
 * Parse the command line into options.
 *
 * Unknown `--only` ids are an error rather than a silent no-op: a typo in
 * an operator's command must not look like "everything is seeded".
 */
export function parseArgs(argv: string[]): SeedRunOptions {
  const only: string[] = [];
  let dryRun = false;

  for (const arg of argv) {
    if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg.startsWith('--only=')) {
      const value = arg.slice('--only='.length);
      for (const id of value.split(',')) {
        const trimmed = id.trim();
        if (trimmed) only.push(trimmed);
      }
    } else if (arg === '--list') {
      only.push('__list__');
    }
  }

  return { only, dryRun };
}

/** The dataset ids this run should touch, in registry order. */
export function selectDatasets(only: string[]): SeedDataset[] {
  if (only.length === 0) return [...SEED_DATASETS];
  const known = new Set(SEED_DATASETS.map((d) => d.id));
  const unknown = only.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    throw new Error(
      `unknown dataset id(s): ${unknown.join(', ')}. ` +
        `Known ids: ${[...known].join(', ')}`,
    );
  }
  const wanted = new Set(only);
  return SEED_DATASETS.filter((d) => wanted.has(d.id));
}

/** Format one outcome as a single console line. */
function formatOutcome(outcome: SeedOutcome, dataset: SeedDataset): string {
  if (outcome.status === 'ok') {
    return `  ok      ${dataset.id.padEnd(16)} ${dataset.expected} rows`;
  }
  if (outcome.status === 'failed') {
    return `  FAILED  ${dataset.id.padEnd(16)} ${outcome.error ?? 'unknown error'}`;
  }
  if (outcome.status === 'skipped') {
    return `  skip    ${dataset.id.padEnd(16)} ${outcome.skippedReason ?? 'nothing to do'}`;
  }
  return (
    `  pending ${dataset.id.padEnd(16)} ${outcome.actual}/${dataset.expected} rows` +
    ` — ${outcome.message ?? 'missing data'}`
  );
}

/**
 * Seed the selected datasets and report what happened.
 *
 * A dataset that fails does not stop the run: a broken etymology import
 * must not prevent the HSK grading — the one thing the games area needs —
 * from being seeded.
 */
export async function runSeed(options: SeedRunOptions): Promise<SeedRunReport> {
  const started = Date.now();
  const datasets = selectDatasets(options.only);
  const outcomes: Array<SeedOutcome & { dataset: SeedDataset }> = [];

  for (const dataset of datasets) {
    let outcome: SeedOutcome;
    try {
      outcome = await runSeedDataset(dataset.id, { dryRun: options.dryRun });
    } catch (err) {
      outcome = {
        datasetId: dataset.id,
        status: 'failed',
        actual: 0,
        inserted: 0,
        error: err instanceof Error ? err.message : String(err),
      };
    }
    outcomes.push({ ...outcome, dataset });
  }

  return { dryRun: options.dryRun, outcomes, elapsedMs: Date.now() - started };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.only.includes('__list__')) {
    console.log('Seeded datasets:\n');
    for (const dataset of SEED_DATASETS) {
      console.log(
        `  ${dataset.id.padEnd(16)} ${String(dataset.expected).padStart(6)} rows  ` +
          `${dataset.table}  (${dataset.label})`,
      );
    }
    console.log('\nOptions: --only=<id>[,<id>]  --dry-run  --list');
    return;
  }

  console.log(`Reading current counts${args.dryRun ? ' (dry run)' : ''}...`);
  const counts = await readSeedCounts();
  console.log('');
  for (const dataset of SEED_DATASETS) {
    const actual = counts[dataset.id] ?? 0;
    const mark = actual >= dataset.expected ? 'ok     ' : 'missing';
    console.log(`  ${mark} ${dataset.id.padEnd(16)} ${actual}/${dataset.expected}`);
  }
  console.log('');

  const report = await runSeed(args);
  console.log('Seed run:');
  for (const outcome of report.outcomes) {
    console.log(formatOutcome(outcome, outcome.dataset));
  }
  console.log(`\nDone in ${(report.elapsedMs / 1000).toFixed(1)}s`);

  const failed = report.outcomes.filter((o) => o.status === 'failed');
  if (failed.length > 0) {
    console.error(`\n${failed.length} dataset(s) failed.`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main()
    .then(() => closePool())
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
