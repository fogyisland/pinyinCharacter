import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readdirSync, existsSync } from 'node:fs';

vi.mock('@/lib/db', () => ({
  getPool: vi.fn(),
}));

// Only mock the fs symbols used by readPreservedStats.
vi.mock('node:fs', () => ({
  readdirSync: vi.fn(),
  existsSync: vi.fn(),
}));

import { getPool } from '@/lib/db';
import { readPreservedStats } from '@/app/admin/chars/init/preserved-stats';

const mockedQuery = vi.fn();
const mockedReaddirSync = vi.mocked(readdirSync);
const mockedExistsSync = vi.mocked(existsSync);

(getPool as any).mockReturnValue({ query: mockedQuery });

// DB COUNT(*) rows return: { total: <number> }
const countRow = (n: number) => [[{ total: n }]];

beforeEach(() => {
  mockedQuery.mockReset();
  mockedReaddirSync.mockReset();
  mockedExistsSync.mockReset();
  // Default: all 3 dirs exist
  mockedExistsSync.mockReturnValue(true);
});

describe('readPreservedStats', () => {
  it('returns the expected shape with all counts populated', async () => {
    // 3 DB COUNT(*) queries in order: chars, char_etymology, rare_chars
    mockedQuery
      .mockResolvedValueOnce(countRow(8125))   // chars
      .mockResolvedValueOnce(countRow(1200))   // char_etymology
      .mockResolvedValueOnce(countRow(1412));  // rare_chars
    // 3 readdirSync calls in order: content, poems, classics
    mockedReaddirSync
      .mockReturnValueOnce(['a.json', 'b.json', 'c.json'] as any)  // content
      .mockReturnValueOnce(['1.json', '2.json'] as any)            // poems
      .mockReturnValueOnce(['book1.json'] as any);                 // classics

    const result = await readPreservedStats();

    expect(result).toEqual({
      contentFiles: 3,
      poemFiles: 2,
      classicFiles: 1,
      charRows: 8125,
      charEtymologyRows: 1200,
      rareCharRows: 1412,
    });
  });

  it('returns zeros for missing data directories (no throw)', async () => {
    // DB returns rows, but all 3 data dirs are missing
    mockedQuery
      .mockResolvedValueOnce(countRow(8125))
      .mockResolvedValueOnce(countRow(1200))
      .mockResolvedValueOnce(countRow(1412));
    mockedExistsSync.mockReturnValue(false);

    const result = await readPreservedStats();

    expect(result).toEqual({
      contentFiles: 0,
      poemFiles: 0,
      classicFiles: 0,
      charRows: 8125,
      charEtymologyRows: 1200,
      rareCharRows: 1412,
    });
    // readdirSync should not be called when dirs are missing
    expect(mockedReaddirSync).not.toHaveBeenCalled();
  });

  it('filters out non-.json files in data dirs', async () => {
    mockedQuery
      .mockResolvedValueOnce(countRow(100))
      .mockResolvedValueOnce(countRow(50))
      .mockResolvedValueOnce(countRow(20));
    mockedReaddirSync
      .mockReturnValueOnce(['a.json', '.DS_Store', 'b.json', 'README.md'] as any)
      .mockReturnValueOnce(['1.json', 'notes.txt'] as any)
      .mockReturnValueOnce(['x.json'] as any);

    const result = await readPreservedStats();

    expect(result.contentFiles).toBe(2);
    expect(result.poemFiles).toBe(1);
    expect(result.classicFiles).toBe(1);
  });

  it('issues exactly 3 DB COUNT(*) queries', async () => {
    mockedQuery
      .mockResolvedValueOnce(countRow(0))
      .mockResolvedValueOnce(countRow(0))
      .mockResolvedValueOnce(countRow(0));
    mockedReaddirSync.mockReturnValue([] as any);

    await readPreservedStats();

    expect(mockedQuery).toHaveBeenCalledTimes(3);
    const sqls = mockedQuery.mock.calls.map((c) => String(c[0]));
    expect(sqls[0]).toMatch(/FROM\s+chars/);
    expect(sqls[1]).toMatch(/FROM\s+char_etymology/);
    expect(sqls[2]).toMatch(/FROM\s+rare_chars/);
  });
});
