/**
 * scripts/init-db.ts — the rare-chars seeder must write the pinyin.
 *
 * The /rare-chars card renders the character, the pinyin and the meaning.
 * The seeder used to insert only the character:
 *
 *     INSERT IGNORE INTO rare_chars (`char`) VALUES (?)
 *
 * so every row got an empty pinyin and every card on the page showed a
 * blank line between the character and its meaning — 1409 blank cards.
 * The content JSON already carries the pinyin (`data/content/<char>.json`
 * has a `pinyin` field), and pinyin-pro is the fallback for the rare
 * character that has none.
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

// The content directory is scanned for rare characters. Point the scan at
// a fixture list so the test does not depend on the corpus — everything
// else on the filesystem keeps working.
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  const readdir = (path: unknown, ...rest: unknown[]) => {
    if (typeof path === 'string' && path.replace(/\\/g, '/').endsWith('data/content')) {
      return ['㑇.json', '㑊.json', 'plain.json'];
    }
    return (actual.readdirSync as (...args: unknown[]) => unknown)(path, ...rest);
  };
  return {
    ...actual,
    readdirSync: readdir,
  };
});

vi.mock('@/lib/json-fs', async () => {
  const actual = await vi.importActual<typeof import('@/lib/json-fs')>('@/lib/json-fs');
  return {
    ...actual,
    readJsonAuto: vi.fn(),
  };
});

import { getPool } from '@/lib/db';
import { getSeedDataset } from '@/lib/seed-registry';
import { readJsonAuto } from '@/lib/json-fs';
import { initRareChars } from '@/scripts/init-db';

/** Every query the seeder ran, in order. */
let queries: Array<{ sql: string; params: unknown[] }> = [];

/** The row count the mocked pool reports for the rare_chars table. */
let tableCount = 0;

/** The expected size the mocked registry reports. */
let expected = 100;

beforeEach(() => {
  queries = [];
  tableCount = 0;
  expected = 100;

  const pool = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      if (sql.includes('COUNT(*)')) return [[{ count: tableCount }], []];
      if (sql.includes('UPDATE')) return [{ affectedRows: 1 }, []];
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
      }) as never,
  );

  vi.mocked(readJsonAuto).mockImplementation((path: string) => {
    if (path.endsWith('㑇.json')) {
      return { char: '㑇', level: 3, pinyin: 'zhòu', rare: { meaning: '古同' } };
    }
    if (path.endsWith('㑊.json')) {
      return { char: '㑊', level: 3, rare: { meaning: '人行走的样子' } };
    }
    // Not a rare character — level 1.
    return { char: '一', level: 1, pinyin: 'yī', rare: { meaning: '数字一' } };
  });});

describe('initRareChars', () => {
  it('writes the pinyin along with the character', async () => {
    await initRareChars();

    const insert = queries.find((q) => q.sql.includes('INSERT'));
    expect(insert).toBeDefined();
    // The insert must carry a pinyin column.
    expect(insert!.sql).toContain('pinyin');
    // 㑇 has a pinyin in its content JSON — it must be written through.
    const params = insert!.params as string[];
    expect(params).toContain('㑇');
    expect(params).toContain('zhòu');
  });

  it('falls back to a generated pinyin when the content JSON has none', async () => {
    await initRareChars();

    const insert = queries.find((q) => q.sql.includes('INSERT'));
    expect(insert).toBeDefined();
    const params = insert!.params as string[];
    const index = params.indexOf('㑊');
    expect(index).toBeGreaterThan(-1);
    // The character right after it is the pinyin — it must not be empty.
    const pinyin = params[index + 1];
    expect(typeof pinyin).toBe('string');
    expect(pinyin!.length).toBeGreaterThan(0);
  });

  it('does not write a character that is not a rare one', async () => {
    await initRareChars();

    const insert = queries.find((q) => q.sql.includes('INSERT'));
    expect(insert).toBeDefined();
    const params = insert!.params as string[];
    expect(params).not.toContain('一');
  });

  it('fills in the pinyin of rows that already exist without one', async () => {
    await initRareChars();

    const update = queries.find((q) => q.sql.includes('UPDATE'));
    expect(update).toBeDefined();
    // Only the rows with an EMPTY pinyin are touched — a hand-corrected
    // pinyin must survive.
    expect(update!.sql).toContain('pinyin =');
    expect(update!.sql).toContain("pinyin = ''");
    const params = update!.params as string[];
    expect(params).toContain('㑇');
    expect(params).toContain('zhòu');
  });

  /**
   * MySQL evaluates a WHERE clause ONCE per statement, so
   *
   *     UPDATE t SET pinyin = ? WHERE `char` = ?
   *
   * with several parameter sets only ever matches the FIRST row — every
   * other character keeps its empty pinyin. The batch must assign each
   * row its own value.
   */
  it('assigns each row its own pinyin in one statement', async () => {
    await initRareChars();

    const update = queries.find((q) => q.sql.includes('UPDATE'));
    expect(update).toBeDefined();
    // A CASE expression — one assignment per character.
    expect(update!.sql).toContain('CASE');
    expect(update!.sql).toMatch(/WHEN \? THEN \?/);
    // The parameters carry (char, pinyin) for EVERY row, not just the
    // first one. Each character appears twice: once in the WHEN clause
    // and once in the IN list that scopes the update.
    const params = update!.params as string[];
    expect(params.filter((p) => p === '㑇').length).toBe(2);
    expect(params.filter((p) => p === '㑊').length).toBe(2);
    expect(params.filter((p) => p === 'zhòu').length).toBe(1);
  });

  it('does not skip a table whose rows are all missing a pinyin', async () => {
    // The table holds enough ROWS, but none of them has a pinyin — the
    // page would render 1409 broken cards, so the seeder must not skip.
    tableCount = 0; // COUNT(*) WHERE pinyin <> '' → 0
    expected = 100;

    const stats = await initRareChars();

    expect(stats.skipped).toBe(false);
    expect(queries.some((q) => q.sql.includes('INSERT'))).toBe(true);
  });

  it('skips a table whose rows all have a pinyin', async () => {
    tableCount = 100; // COUNT(*) WHERE pinyin <> '' → 100 >= expected
    expected = 100;

    const stats = await initRareChars();

    expect(stats.skipped).toBe(true);
    expect(queries.some((q) => q.sql.includes('INSERT'))).toBe(false);
  });
});
