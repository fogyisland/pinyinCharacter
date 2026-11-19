/**
 * The seeding engine — reads what the database holds and fills the gaps.
 *
 * The rule every dataset follows: **"enough counts as seeded"**.
 *
 * The old seeders used "any row means seeded", so a database with a single
 * row was considered complete and never topped up. That is how a partial
 * import stays partial forever while every check reports green. Here each
 * dataset declares how many rows it expects (from `lib/seed-registry.ts`),
 * and a dataset is only complete when it holds at least that many.
 *
 * Filling is idempotent and additive:
 *
 *  - rows the operator added by hand are never deleted;
 *  - re-running the seed is a no-op once the database is complete;
 *  - a dataset that fails never stops the others from being seeded.
 */
import type { RowDataPacket } from 'mysql2';
import { getPool } from './db';
import { SEED_DATASETS, getSeedDataset, seedOrder, type SeedDataset } from './seed-registry';

/** What happened to one dataset in one run. */
export type SeedStatus = 'ok' | 'pending' | 'skipped' | 'failed';

export interface SeedOutcome {
  datasetId: string;
  status: SeedStatus;
  /** How many rows the database holds for this dataset after the run. */
  actual: number;
  /** How many rows this run wrote. */
  inserted: number;
  /** Why the dataset was skipped, when it was. */
  skippedReason?: string;
  /** Why the dataset is still incomplete, when it is. */
  message?: string;
  /** The failure text, when it failed. */
  error?: string;
}

/** Counts of the rows each dataset currently holds, keyed by dataset id. */
export type SeedCounts = Record<string, number>;

/**
 * How each dataset's rows are counted and topped up.
 *
 * `count` reads the current state; `fill` brings the database up to the
 * expected size. Both are separate so the admin page can show a gap
 * without writing anything.
 */
interface SeedHandler {
  /** Read how many rows the database holds for this dataset. */
  count(): Promise<number>;
  /**
   * Add whatever is missing, without deleting or overwriting anything the
   * operator may have added by hand. Returns how many rows were written.
   */
  fill(options: { dryRun: boolean }): Promise<number>;
}

/** A `SELECT COUNT(*)` row. */
interface CountRow extends RowDataPacket {
  n: number;
}

/** A char row read back from the `chars` table. */
interface CharRow extends RowDataPacket {
  c_char: string;
}

/** Read a single count out of the pool, tolerating a missing table. */
async function scalarCount(sql: string, params: unknown[] = []): Promise<number> {
  const pool = getPool();
  const [rows] = await pool.query<CountRow[]>(sql, params);
  const row = rows[0];
  return row ? Number(row.n ?? 0) : 0;
}

/**
 * Read the HSK grading coverage.
 *
 * `chars.hsk_level` is a column on the `chars` table, so the count is the
 * number of chars that carry a grade — not the number of rows.
 */
async function countHskGrading(): Promise<number> {
  return scalarCount('SELECT COUNT(hsk_level) AS n FROM chars');
}

/**
 * Fill the HSK grading.
 *
 * Only chars that ALREADY exist in the `chars` table are graded. The
 * vocabulary file and the chars table are different sets: the vocabulary
 * has 2632 characters, the table has 8105, and a few vocabulary characters
 * are outside the BMP-filtered set the table was built from. Grading those
 * would insert rows with a NULL `level`, which the games area treats as
 * ungraded — so they are reported as missing rather than invented.
 *
 * The rows are written with a single multi-row UPDATE per level rather
 * than one statement per character: `scripts/import-hsk.ts` does 2632
 * round-trips, which is far too slow for a boot path.
 */
async function fillHskGrading(options: { dryRun: boolean }): Promise<number> {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const vocab = JSON.parse(
    readFileSync(join(process.cwd(), 'data', 'hsk-vocab.json'), 'utf8'),
  ) as Record<string, Array<{ char: string }>>;

  const pool = getPool();
  let written = 0;

  for (const level of ['1', '2', '3', '4', '5', '6'] as const) {
    const entries = vocab[level];
    if (!Array.isArray(entries) || entries.length === 0) continue;
    const chars = entries.map((e) => e.char);
    const lvl = Number(level);

    // Which of these characters exist in `chars` and are still ungraded?
    //
    // The alias is `c_char`, not `char`: `char` is a MySQL reserved word
    // (CHARACTER SET), so `AS char` is a parse error even though the
    // column reference it aliases is quoted. The server rejected the
    // seed with:
    //   ER_PARSE_ERROR ... near 'char FROM chars c LEFT JOIN ...'
    const [existing] = await pool.query<CharRow[]>(
      `SELECT c.\`char\` AS c_char FROM chars c
        LEFT JOIN (SELECT \`char\`, hsk_level FROM chars WHERE hsk_level IS NOT NULL) g
          ON g.\`char\` = c.\`char\`
       WHERE c.\`char\` IN (?) AND g.\`char\` IS NULL`,
      [chars],
    );
    const missing = existing.map((r) => r.c_char);
    if (missing.length === 0) continue;

    if (options.dryRun) {
      written += missing.length;
      continue;
    }

    // Batch the UPDATE. The IN list is chunked so the statement stays well
    // under MySQL's max_allowed_packet for the 922-character level 6.
    const CHUNK = 200;
    for (let offset = 0; offset < missing.length; offset += CHUNK) {
      const chunk = missing.slice(offset, offset + CHUNK);
      const placeholders = chunk.map(() => '?').join(', ');
      // The level is the FIRST placeholder (`SET hsk_level = ?`), so it is
      // the first parameter. Putting the characters first would bind the
      // level to the character list and grade every char with a character.
      const params = [lvl, ...chunk];
      await pool.query(
        `UPDATE chars SET hsk_level = ? WHERE \`char\` IN (${placeholders})`,
        params,
      );
      written += chunk.length;
    }
  }

  return written;
}

/**
 * Count the chars that have no etymology row.
 *
 * The etymology table holds one row per char, so "enough" means every char
 * in the table has a row — the count is the join, not the table size.
 */
async function countCharEtymology(): Promise<number> {
  return scalarCount(
    `SELECT COUNT(*) AS n FROM chars c
      JOIN char_etymology e ON e.\`char\` = c.\`char\``,
  );
}

/**
 * Fill the etymology rows.
 *
 * The seeder in `scripts/init-db.ts` already knows how to build a row; this
 * calls it rather than reimplementing the era-font mapping.
 */
async function fillCharEtymology(options: { dryRun: boolean }): Promise<number> {
  const { initCharEtymology } = await import('../scripts/init-db');
  if (options.dryRun) {
    const missing = await scalarCount(
      `SELECT COUNT(*) AS n FROM chars c
        LEFT JOIN char_etymology e ON e.\`char\` = c.\`char\`
       WHERE e.\`char\` IS NULL`,
    );
    return missing;
  }
  const result = await initCharEtymology();
  return result.inserted;
}

/** Count the rows of a plain table. */
async function countTable(table: string): Promise<number> {
  return scalarCount(`SELECT COUNT(*) AS n FROM \`${table}\``);
}

/** What a seeder returns: how many rows it wrote, and why it failed. */
interface SeederResult {
  inserted: number;
  failed?: string;
}

/**
 * Fill a plain table through its builder.
 *
 * The builders (`build-poems`, `build-classics`, `build-sutras`) are
 * file-based and idempotent — they insert what is missing and leave the
 * rest alone.
 *
 * The builders report a failure in a `failed` field rather than
 * throwing, because they are also called from the boot path where a
 * single broken import must not stop the others. That field is turned
 * back into a throw here: a seeder that silently inserted nothing would
 * be reported as a success, and the gap would look closed while the
 * table is still empty.
 */
function fillViaBuilder(
  load: () => Promise<() => Promise<number | SeederResult>>,
): (options: { dryRun: boolean }) => Promise<number> {
  return async (options) => {
    if (options.dryRun) return 0;
    const build = await load();
    const result = await build();
    if (typeof result === 'number') return result;
    if (result.failed) {
      throw new Error(result.failed);
    }
    return result.inserted;
  };
}

/**
 * The handler for every dataset.
 *
 * The key is the dataset id from the registry; a dataset without a handler
 * cannot be seeded and the registry's `strategy` must say so.
 */
const HANDLERS: Record<string, SeedHandler> = {
  'hsk-grading': {
    count: countHskGrading,
    fill: fillHskGrading,
  },
  chars: {
    count: () => countTable('chars'),
    fill: fillViaBuilder(async () => {
      const { initChars } = await import('../scripts/init-db');
      // The whole result, not just `inserted`: a seeder that caught its
      // own error reports it in `failed`, and dropping that field would
      // turn a failed import into a successful-looking no-op.
      return async () => initChars();
    }),
  },
  'rare-chars': {
    count: () => countTable('rare_chars'),
    fill: fillViaBuilder(async () => {
      const { initRareChars } = await import('../scripts/init-db');
      return async () => initRareChars();
    }),
  },
  'char-etymology': {
    count: countCharEtymology,
    fill: fillCharEtymology,
  },
  poems: {
    count: () => countTable('poems'),
    fill: fillViaBuilder(async () => {
      const { initPoems } = await import('../scripts/init-db');
      return async () => initPoems();
    }),
  },
  classics: {
    count: () => countTable('classics'),
    fill: fillViaBuilder(async () => {
      const { initClassics } = await import('../scripts/init-db');
      return async () => initClassics();
    }),
  },
  sutras: {
    count: () => countTable('sutras'),
    fill: fillViaBuilder(async () => {
      const { initSutras } = await import('../scripts/init-db');
      return async () => initSutras();
    }),
  },
  idioms: {
    count: () => countTable('idioms'),
    // The importer lives in `scripts/`, not `lib/`, so it is imported here
    // rather than being inlined — one script owns the write, and the seed
    // runner calls it. `importIdioms` throws on an invalid file, which
    // `fillViaBuilder` turns into a reported failure rather than a partial
    // write.
    fill: fillViaBuilder(async () => {
      const { readIdiomRows, importIdioms } = await import('../scripts/import-idioms');
      return async () => {
        const rows = readIdiomRows();
        await importIdioms(rows);
        return { inserted: rows.length };
      };
    }),
  },
};

/**
 * Read the current row count of every dataset.
 *
 * A dataset whose table is missing counts as 0 rather than throwing — a
 * fresh database that has not been migrated yet is exactly the case where
 * the admin page needs to say "nothing is seeded".
 */
export async function readSeedCounts(): Promise<SeedCounts> {
  const counts: SeedCounts = {};
  for (const dataset of SEED_DATASETS) {
    const handler = HANDLERS[dataset.id];
    if (!handler) {
      counts[dataset.id] = 0;
      continue;
    }
    try {
      counts[dataset.id] = await handler.count();
    } catch {
      counts[dataset.id] = 0;
    }
  }
  return counts;
}

/** Read the current row count of one dataset. */
export async function readSeedCount(datasetId: string): Promise<number> {
  const handler = HANDLERS[datasetId];
  if (!handler) return 0;
  try {
    return await handler.count();
  } catch {
    return 0;
  }
}

/**
 * Seed one dataset if it is incomplete.
 *
 * The function never throws: a failure is reported through the returned
 * outcome, so one broken dataset cannot take down the boot path.
 */
export async function runSeedDataset(
  datasetId: string,
  options: { dryRun: boolean } = { dryRun: false },
): Promise<SeedOutcome> {
  const dataset: SeedDataset | undefined = getSeedDataset(datasetId);
  if (!dataset) {
    return {
      datasetId,
      status: 'failed',
      actual: 0,
      inserted: 0,
      error: `unknown dataset "${datasetId}"`,
    };
  }

  const handler = HANDLERS[dataset.id];
  if (!handler) {
    return {
      datasetId,
      status: 'skipped',
      actual: 0,
      inserted: 0,
      skippedReason: 'no seeder is registered for this dataset',
    };
  }

  let actual = 0;
  try {
    actual = await handler.count();
  } catch (err) {
    return {
      datasetId,
      status: 'failed',
      actual: 0,
      inserted: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  if (actual >= dataset.expected) {
    return {
      datasetId,
      status: 'ok',
      actual,
      inserted: 0,
      skippedReason: `already complete (${actual}/${dataset.expected})`,
    };
  }

  try {
    const inserted = await handler.fill(options);
    const after = options.dryRun ? actual : await handler.count();
    return {
      datasetId,
      status: after >= dataset.expected ? 'ok' : 'pending',
      actual: after,
      inserted,
      message:
        after >= dataset.expected
          ? undefined
          : `${after}/${dataset.expected} — ${dataset.dependsOn}`,
    };
  } catch (err) {
    return {
      datasetId,
      status: 'failed',
      actual,
      inserted: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Seed every dataset that is incomplete.
 *
 * The datasets are seeded in dependency order, not in array order: the
 * HSK grading writes a column on the `chars` table, so it has to run
 * after the characters are in place, and the etymology rows are joined
 * against `chars` for the same reason. Seeding them in the wrong order
 * leaves them empty for good — the run is over, and nothing comes back
 * to fill them.
 */
export async function runAllSeeds(
  options: { dryRun: boolean } = { dryRun: false },
): Promise<SeedOutcome[]> {
  const outcomes: SeedOutcome[] = [];
  for (const dataset of seedOrder(SEED_DATASETS)) {
    outcomes.push(await runSeedDataset(dataset.id, options));
  }
  return outcomes;
}
