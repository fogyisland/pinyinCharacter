/**
 * lib/rare-chars.ts — the pinyin must never be blank.
 *
 * The rare_chars table's pinyin column was seeded empty (the seeder
 * inserted only the character), so every card on /rare-chars rendered a
 * blank line between the character and its meaning.
 *
 * Two layers keep that from happening again:
 *
 *   1. the seeder writes the pinyin, and
 *   2. the reader falls back to pinyin-pro when the column is empty.
 *
 * The second layer matters on its own: a database that was seeded before
 * the fix, or one whose pinyin was cleared, must still render.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

vi.mock('@/lib/db', () => ({
  getPool: vi.fn(),
  closePool: vi.fn(),
}));

vi.mock('@/lib/content', () => ({
  readContentFromFs: vi.fn(() => ({
    rare: { meaning: '古同', story: '' },
    etymology: null,
  })),
}));

vi.mock('@/lib/legacy-content-schema', () => ({
  getLegacyContentSchema: vi.fn(async () => ({ rare: [], chars: [] })),
  toSelectList: vi.fn(() => ''),
}));

import { getPool } from '@/lib/db';
import { listChars } from '@/lib/rare-chars';

interface RareCharRow {
  char: string;
  pinyin: string;
  needs_review: number;
}

/** The rows the mocked pool reports. */
let rows: RareCharRow[] = [];

beforeEach(() => {
  rows = [];
  const pool = {
    query: vi.fn(async (sql: string) => {
      if (sql.includes('COUNT(*)')) return [[{ total: rows.length }], []];
      return [rows, []];
    }),
    getConnection: vi.fn(),
  };
  vi.mocked(getPool).mockReturnValue(pool as never);
});

describe('listChars', () => {
  it('keeps the pinyin from the database', async () => {
    rows = [{ char: '㑇', pinyin: 'zhòu', needs_review: 1 }];

    const result = await listChars({ page: 1 });

    expect(result.chars).toHaveLength(1);
    expect(result.chars[0].pinyin).toBe('zhòu');
  });

  it('generates a pinyin when the database has none', async () => {
    rows = [{ char: '㑇', pinyin: '', needs_review: 1 }];

    const result = await listChars({ page: 1 });

    expect(result.chars).toHaveLength(1);
    expect(result.chars[0].pinyin.length).toBeGreaterThan(0);
  });
});
