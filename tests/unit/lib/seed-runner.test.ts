/**
 * lib/seed-runner.ts — "enough counts as seeded".
 *
 * The old seeders used "any row means seeded", so a database holding a
 * single row was considered complete and never topped up. A partial import
 * stayed partial forever while every check reported green. The runner
 * replaces that rule: a dataset is complete only when it holds at least
 * the number of rows the repository ships.
 *
 * The database layer is mocked, so these tests need no DB. The mocked pool
 * records every statement so the tests can assert not just the outcome
 * but what was actually written.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

vi.mock('@/lib/db', () => ({
  getPool: vi.fn(),
  closePool: vi.fn(),
}));

import { getPool } from '@/lib/db';
import {
  runSeedDataset,
  readSeedCounts,
  readSeedCount,
  runAllSeeds,
} from '@/lib/seed-runner';
import { SEED_DATASETS, seedOrder } from '@/lib/seed-registry';
import hskVocab from '@/data/hsk-vocab.json';

/** A recorded query. */
interface RecordedQuery {
  sql: string;
  params: unknown[];
}

/** The rows the mocked pool answers each count query with. */
const counts: Record<string, number> = {};

/** Every statement the code under test issued. */
let issued: RecordedQuery[] = [];

/**
 * Answer a query from the `counts` map.
 *
 * The key is a substring of the SQL. The HSK grading count asks for
 * `COUNT(hsk_level)`, the plain table counts ask for `COUNT(*)`, so the
 * HSK key is checked first.
 */
function answerFor(sql: string): unknown[] {
  const hsk = Object.keys(counts).find((key) => key.startsWith('hsk:'));
  if (hsk && sql.includes('COUNT(hsk_level)')) {
    return [{ n: counts[hsk] }];
  }
  for (const [key, value] of Object.entries(counts)) {
    if (sql.includes(key)) return [{ n: value }];
  }
  return [];
}

beforeEach(() => {
  issued = [];
  for (const key of Object.keys(counts)) delete counts[key];

  const pool = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      issued.push({ sql, params });
      // A row-shaped query (the "which chars are ungraded" lookup) answers
      // with chars when the test asked for them.
      //
      // The lookup aliases the column as `c_char` — `char` is a MySQL
      // reserved word, and `AS char` was a parse error on the server.
      // The mock keys off that alias, so it breaks if the alias changes.
      if (sql.includes('AS c_char')) {
        const wanted = Array.isArray(params[0]) ? (params[0] as string[]) : [];
        const rows = wanted.slice(0, Number(counts['ungraded:limit'] ?? 0)).map((char) => ({
          c_char: char,
        }));
        return [rows, []];
      }
      // An UPDATE that grades characters raises the graded count, the way
      // the real database would. Without this the mock would report the
      // same count before and after a fill, and a test could not tell a
      // runner that topped the dataset up from one that did not.
      if (sql.includes('UPDATE chars SET hsk_level')) {
        const chunkSize = Math.max(0, params.length - 1);
        const hskKey = Object.keys(counts).find((key) => key.startsWith('hsk:'));
        if (hskKey) counts[hskKey] = Number(counts[hskKey]) + chunkSize;
        return [{ affectedRows: chunkSize }, []];
      }
      return [answerFor(sql), []];
    }),
    getConnection: vi.fn(),
  };
  vi.mocked(getPool).mockReturnValue(pool as never);
});

describe('seed runner — "enough counts as seeded"', () => {
  it('reports a complete dataset as ok without writing anything', async () => {
    counts['hsk:'] = 2632;

    const outcome = await runSeedDataset('hsk-grading');

    expect(outcome.status).toBe('ok');
    expect(outcome.actual).toBe(2632);
    expect(outcome.inserted).toBe(0);
    expect(issued.filter((q) => q.sql.includes('UPDATE'))).toHaveLength(0);
  });

  it('tops up a PARTIAL dataset instead of skipping it', async () => {
    // 1000 of 2632 graded — the exact state a half-finished import leaves.
    counts['hsk:'] = 1000;
    counts['ungraded:limit'] = 5;

    const outcome = await runSeedDataset('hsk-grading');

    expect(outcome.status).not.toBe('ok');
    const updates = issued.filter((q) => q.sql.includes('UPDATE chars SET hsk_level'));
    expect(updates.length).toBeGreaterThan(0);
  });

  it('writes the grade as the FIRST parameter, so the level lands in the right column', async () => {
    counts['hsk:'] = 0;
    counts['ungraded:limit'] = 3;

    await runSeedDataset('hsk-grading');

    const update = issued.find((q) => q.sql.includes('UPDATE chars SET hsk_level'));
    expect(update).toBeDefined();
    // `SET hsk_level = ? WHERE char IN (...)` — the level comes first, then
    // the characters. A swapped order would grade every char with the
    // character list, which is the bug this pins.
    expect(typeof update!.params[0]).toBe('number');
    expect(Array.isArray(update!.params[0])).toBe(false);
    const level = update!.params[0] as number;
    expect(level).toBeGreaterThanOrEqual(1);
    expect(level).toBeLessThanOrEqual(6);
    // The characters follow the level.
    const charParams = update!.params.slice(1);
    expect(charParams.length).toBeGreaterThan(0);
    for (const char of charParams) {
      expect(typeof char).toBe('string');
    }
  });

  it('grades each char with the level it belongs to, not one level for all', async () => {
    counts['hsk:'] = 0;
    // Return every requested char as ungraded, so all six levels are hit.
    counts['ungraded:limit'] = 1000;

    await runSeedDataset('hsk-grading');

    const levels = issued
      .filter((q) => q.sql.includes('UPDATE chars SET hsk_level'))
      .map((q) => q.params[0]);

    expect(new Set(levels).size).toBeGreaterThan(1);
    for (const level of levels) {
      expect(level).toBeGreaterThanOrEqual(1);
      expect(level).toBeLessThanOrEqual(6);
    }
  });

  it('does not write anything on a dry run', async () => {
    counts['hsk:'] = 0;

    await runSeedDataset('hsk-grading', { dryRun: true });

    expect(issued.filter((q) => q.sql.includes('UPDATE'))).toHaveLength(0);
  });

  it('never writes the reserved word `char` unquoted', async () => {
    // `char` is a MySQL reserved word (CHARACTER SET). An unquoted one is
    // a parse error, and the production server rejected the seed with:
    //   ER_PARSE_ERROR ... near 'char FROM chars c LEFT JOIN ...'
    // The mocked pool never parses SQL, so this asserts on the statement
    // text itself: every `char` that is not inside backticks is a bug.
    counts['hsk:'] = 0;
    counts['ungraded:limit'] = 3;

    await runSeedDataset('hsk-grading');

    expect(issued.length).toBeGreaterThan(0);
    for (const query of issued) {
      // Strip the string literals and the placeholders, then look for a
      // bare `char` word.
      const withoutLiterals = query.sql.replace(/'[^']*'/g, "''").replace(/\?/g, '?');
      const bare = withoutLiterals.replace(/`[^`]*`/g, '').match(/\bchar\b/i);
      expect(
        bare,
        `statement uses the reserved word char unquoted: ${query.sql}`,
      ).toBeNull();
    }
  });

  it('reads the ungraded chars back under a name MySQL can return', async () => {
    // The alias has to be backticked too — `AS char` fails the same way
    // a bare column does — and the row is read back under that name.
    counts['hsk:'] = 0;
    counts['ungraded:limit'] = 3;

    await runSeedDataset('hsk-grading');

    const select = issued.find((q) => q.sql.includes('LEFT JOIN'));
    expect(select).toBeDefined();
    expect(select!.sql).toMatch(/AS\s+`?\w+`?/);
  });

  it('reports a failed dataset without throwing', async () => {
    const pool = {
      query: vi.fn(async () => {
        throw new Error('connection lost');
      }),
      getConnection: vi.fn(),
    };
    vi.mocked(getPool).mockReturnValue(pool as never);

    const outcome = await runSeedDataset('hsk-grading');

    expect(outcome.status).toBe('failed');
    expect(outcome.error).toContain('connection lost');
  });

  it('never reports a failure as a success', async () => {
    const pool = {
      query: vi.fn(async () => {
        throw new Error('connection lost');
      }),
      getConnection: vi.fn(),
    };
    vi.mocked(getPool).mockReturnValue(pool as never);

    const outcome = await runSeedDataset('hsk-grading');

    // A failure that reads as "ok" would let the boot path claim the
    // content is seeded when it is not — the exact class of bug this
    // whole change exists to remove.
    expect(outcome.status).not.toBe('ok');
    expect(outcome.status).toBe('failed');
  });

  it('never reports a failed FILL as a success', async () => {
    // The count succeeds (the dataset is incomplete) but the write fails.
    // A failure reported as "ok" would tell the boot path that the content
    // is seeded when the write never happened.
    let calls = 0;
    const pool = {
      query: vi.fn(async (sql: string) => {
        calls++;
        if (sql.includes('COUNT(hsk_level)')) return [[{ n: 0 }], []];
        throw new Error('deadlock found when trying to get lock');
      }),
      getConnection: vi.fn(),
    };
    vi.mocked(getPool).mockReturnValue(pool as never);

    const outcome = await runSeedDataset('hsk-grading');

    expect(calls).toBeGreaterThan(0);
    expect(outcome.status).not.toBe('ok');
    expect(outcome.status).toBe('failed');
    expect(outcome.error).toContain('deadlock');
  });

  it('treats a dataset that is ONE row short as incomplete', async () => {
    // 2631 of 2632 graded. A comparison of `>` instead of `>=` would call
    // this complete and leave the last character ungraded forever.
    counts['hsk:'] = 2631;
    counts['ungraded:limit'] = 1;

    const outcome = await runSeedDataset('hsk-grading');

    // It must go and grade the missing character.
    const updates = issued.filter((q) => q.sql.includes('UPDATE chars SET hsk_level'));
    expect(updates.length).toBeGreaterThan(0);
    // And after that write the dataset is complete.
    expect(outcome.status).toBe('ok');
    expect(outcome.inserted).toBeGreaterThan(0);
  });

  it('writes nothing on a dry run, even when the dataset is empty', async () => {
    counts['hsk:'] = 0;
    counts['ungraded:limit'] = 10;

    await runSeedDataset('hsk-grading', { dryRun: true });

    // Not one UPDATE may reach the database on a dry run.
    expect(issued.filter((q) => q.sql.includes('UPDATE'))).toHaveLength(0);
    expect(issued.filter((q) => q.sql.includes('INSERT'))).toHaveLength(0);
  });

  it('grades a char with its own level, not with the level of another one', async () => {
    counts['hsk:'] = 0;
    counts['ungraded:limit'] = 1000;

    await runSeedDataset('hsk-grading');

    const updates = issued.filter((q) => q.sql.includes('UPDATE chars SET hsk_level'));

    // The vocabulary spans six levels, so at least two distinct grades
    // must appear. A grader that collapsed every level onto one value
    // would break the game's difficulty tiers.
    const levels = updates.map((q) => q.params[0]);
    expect(new Set(levels).size).toBeGreaterThan(1);

    // And the grade must match the characters: the characters written with
    // grade N must be characters the vocabulary files under level N. A
    // grader that shifted every level by one would still produce several
    // distinct grades, so only this check catches it.
    const gradeOf = new Map<number, string[]>();
    for (const update of updates) {
      const level = update.params[0] as number;
      const chars = update.params.slice(1) as string[];
      gradeOf.set(level, [...(gradeOf.get(level) ?? []), ...chars]);
    }
    for (const [level, chars] of gradeOf) {
      const expectedChars = new Set(
        (hskVocab[String(level) as '1'] ?? []).map((e) => e.char),
      );
      for (const char of chars) {
        expect(
          expectedChars.has(char),
          `character "${char}" was graded ${level} but belongs to another level`,
        ).toBe(true);
      }
    }
  });

  it('reports an unknown dataset as failed rather than throwing', async () => {
    const outcome = await runSeedDataset('not-a-dataset');

    expect(outcome.status).toBe('failed');
    expect(outcome.error).toContain('not-a-dataset');
  });

  it('keeps going after one dataset fails', async () => {
    counts['hsk:'] = 0;
    const outcomes = await runAllSeeds();

    expect(outcomes).toHaveLength(SEED_DATASETS.length);
    // Every dataset produced an outcome — the run did not abort.
    for (const outcome of outcomes) {
      expect(outcome.datasetId).toBeTruthy();
    }
  });
});

describe('seed runner — the order the datasets are seeded in', () => {
  // The order is not cosmetic. The HSK grading writes a column on the
  // `chars` table; if it runs first it finds an empty table, grades
  // nothing, and the run is over — the column stays empty for good.
  // That is exactly what a production server looked like: every dataset
  // at zero, and the grading unable to do anything about it.

  it('seeds the characters before the grading', async () => {
    const outcomes = await runAllSeeds();

    const ids = outcomes.map((o) => o.datasetId);
    expect(ids.indexOf('chars')).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf('chars')).toBeLessThan(ids.indexOf('hsk-grading'));
  });

  it('seeds the characters before the etymology rows', async () => {
    const outcomes = await runAllSeeds();

    const ids = outcomes.map((o) => o.datasetId);
    expect(ids.indexOf('chars')).toBeLessThan(ids.indexOf('char-etymology'));
  });

  it('reports the outcomes in dependency order too', () => {
    // The report is read by an operator; an order that contradicts the
    // run would be misleading.
    const ids = seedOrder(SEED_DATASETS).map((d) => d.id);
    expect(ids.indexOf('chars')).toBeLessThan(ids.indexOf('hsk-grading'));
  });
});

describe('seed runner — reading the current state', () => {
  it('reads a count for every dataset', async () => {
    counts['FROM `chars`'] = 8105;

    const all = await readSeedCounts();

    for (const dataset of SEED_DATASETS) {
      expect(all).toHaveProperty(dataset.id);
    }
  });

  it('reports zero for a dataset whose table is missing', async () => {
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('ER_NO_SUCH_TABLE') || sql.includes('no such table')) {
          throw new Error("ER_NO_SUCH_TABLE: Table 'piyin.sutras' doesn't exist");
        }
        return [[], []];
      }),
      getConnection: vi.fn(),
    };
    vi.mocked(getPool).mockReturnValue(pool as never);

    expect(await readSeedCount('sutras')).toBe(0);
  });
});
