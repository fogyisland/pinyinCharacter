import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * `getPool()` is mocked per test so that every test gets its own pool object:
 * `getLegacyContentSchema` caches the probed schema per pool (a WeakMap),
 * so a fresh pool means a fresh probe and the tests stay independent.
 */
const state = vi.hoisted(() => ({
  pool: null as unknown,
  queries: [] as Array<{ sql: string; params: unknown[] }>,
  legacyColumns: new Map<string, string[]>(),
}));

vi.mock('@/lib/db', () => ({
  getPool: () => state.pool,
}));

// No content JSON on disk for the char under test — force the DB fallback.
vi.mock('@/lib/json-fs', () => ({
  readJsonAuto: () => null,
}));

import { getContent } from '@/lib/content';

/** The columns a table exposes on the slim schema (before any legacy extras). */
const STRUCTURAL_COLUMNS: Record<string, string[]> = {
  chars: ['level', 'pinyin'],
  rare_chars: ['pinyin'],
  char_etymology: [],
  char_story: ['story'],
};

/** Build a mock pool that answers the schema probe and the content queries. */
function makePool(legacyColumns: Record<string, string[]>, hasCharStoryTable = false) {
  state.legacyColumns = new Map(Object.entries(legacyColumns));
  const pool = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      state.queries.push({ sql, params });

      if (sql.includes('information_schema.columns')) {
        const table = String(params[0]);
        const present = state.legacyColumns.get(table) ?? [];
        return [present.map((column_name) => ({ column_name }))];
      }
      if (sql.includes('information_schema.tables')) {
        return [hasCharStoryTable ? [{ table_name: 'char_story' }] : []];
      }

      // MySQL rejects a query that names a column the table does not have.
      // The mock has to do the same, or the test would not reproduce the
      // production failure it is meant to lock down.
      const table = Object.keys(STRUCTURAL_COLUMNS).find((t) => sql.includes(`FROM ${t}`));
      if (table) {
        if (table === 'char_story' && !hasCharStoryTable) {
          throw Object.assign(new Error(`Table 'piyin_dev.char_story' doesn't exist`), {
            code: 'ER_NO_SUCH_TABLE',
          });
        }
        const allowed = new Set([
          ...STRUCTURAL_COLUMNS[table]!,
          ...(state.legacyColumns.get(table) ?? []),
        ]);
        const selected = sql.match(/SELECT\s+(.+?)\s+FROM/)?.[1] ?? '';
        for (const column of selected.split(',').map((c) => c.trim().replace(/`/g, ''))) {
          if (column && !allowed.has(column)) {
            throw Object.assign(
              new Error(`Unknown column '${column}' in 'field list'`),
              { code: 'ER_BAD_FIELD_ERROR' },
            );
          }
        }
      }

      if (sql.includes('FROM chars')) {
        return [[{ level: 2, pinyin: 'nie' }]];
      }
      if (sql.includes('FROM rare_chars')) {
        return [[{ pinyin: 'nie' }]];
      }
      return [[]];
    }),
  };
  state.pool = pool;
  return pool;
}

beforeEach(() => {
  state.queries = [];
  state.legacyColumns = new Map();
});

describe('getContent DB fallback', () => {
  it('resolves on a slim schema instead of throwing on a dropped column', async () => {
    // The slim schema: `rare_chars` has only `char`, `pinyin`, `needs_review`.
    makePool({});
    const content = await getContent('乜');

    expect(content).not.toBeNull();
    expect(content?.char).toBe('乜');
    expect(content?.pinyin).toBe('nie');
    expect(content?.level).toBe(2);
    expect(content?.etymology?.story).toBeUndefined();
    expect(content?.rare).toBeUndefined();
  });

  it('never names a legacy column the database does not have', async () => {
    makePool({});
    await getContent('乜');

    const sql = state.queries.map((q) => q.sql).join('\n');
    for (const column of [
      'meaning_zh',
      'meaning_en',
      'pinyin_alt',
      'variants',
      'generated_by',
      'generated_at',
      'created_at',
    ]) {
      expect(sql).not.toContain(column);
    }
    // `char_story` is dropped in the slim schema, so it is never queried.
    expect(sql).not.toContain('char_story');
  });

  it('still reads a rich schema that has not been migrated yet', async () => {
    makePool(
      {
        chars: ['meaning_zh', 'meaning_en', 'pinyin_alt', 'variants'],
        char_etymology: ['story', 'generated_by', 'generated_at'],
        rare_chars: ['meaning', 'story', 'generated_by', 'generated_at', 'created_at'],
      },
      true,
    );
    const content = await getContent('乜');

    const sql = state.queries.map((q) => q.sql).join('\n');
    expect(sql).toContain('meaning_zh');
    expect(sql).toContain('FROM char_etymology');
    expect(sql).toContain('FROM char_story');
    expect(sql).toContain('FROM rare_chars');
    expect(content?.char).toBe('乜');
  });

  it('probes the schema once per pool', async () => {
    makePool({});
    await getContent('乜');
    const probesAfterFirst = state.queries.filter((q) =>
      q.sql.includes('information_schema'),
    ).length;
    await getContent('亟');

    const probesAfterSecond = state.queries.filter((q) =>
      q.sql.includes('information_schema'),
    ).length;
    expect(probesAfterFirst).toBeGreaterThan(0);
    expect(probesAfterSecond).toBe(probesAfterFirst);
  });
});
