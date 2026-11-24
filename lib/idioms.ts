/**
 * Reading the `idioms` table.
 *
 * The table holds one row per four-character idiom, with its reading, its
 * meaning, its difficulty and its 出处 (source). The reading is stored on the
 * row rather than joined against `chars.pinyin`, because that column was
 * emptied by the 2026-06-17 content migration and is empty for every row.
 */
import type { RowDataPacket } from 'mysql2';
import { getPool } from './db';

/** What the site shows when the DB holds no trustworthy attribution. */
export const PENDING_SOURCE = '出处待考';

/** One idiom, as the game and the idioms page need it. */
export interface Idiom {
  /** The four characters, e.g. "一帆风顺". */
  word: string;
  /** Space-separated tone-marked readings, one per character. */
  pinyin: string;
  /** A Chinese explanation of the meaning. */
  meaning: string;
  /** Difficulty, 1 (easiest) to 4 (literary). */
  level: number;
  /** The theme the idiom belongs to. */
  category: string;
  /** The earliest/classical source, or `出处待考` when none is known. */
  source: string;
}

/** A raw row of the `idioms` table. */
interface IdiomRow extends RowDataPacket {
  word: string;
  pinyin: string;
  meaning: string;
  level: number;
  category: string;
  source?: string | null;
}

/** What the caller wants. */
export interface ListIdiomsOptions {
  /** Only idioms of this level. `undefined` means every level. */
  level?: number;
  /** Only idioms of this level or easier. `undefined` means no upper bound. */
  maxLevel?: number;
  /** Only idioms of this category. `undefined` means every category. */
  category?: string;
  /** How many rows at most. */
  limit?: number;
}

/**
 * Read idioms, easiest first.
 *
 * The order is `level, word` rather than the insertion order, so the game
 * gets the common idioms before the literary ones and the order is stable
 * across restarts.
 */
export async function listIdioms(options: ListIdiomsOptions = {}): Promise<Idiom[]> {
  const pool = getPool();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.level !== undefined) {
    conditions.push('level = ?');
    params.push(options.level);
  }
  if (options.maxLevel !== undefined) {
    conditions.push('level <= ?');
    params.push(options.maxLevel);
  }
  if (options.category !== undefined) {
    conditions.push('category = ?');
    params.push(options.category);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit =
    options.limit !== undefined && options.limit > 0
      ? 'LIMIT ?'
      : '';
  if (limit) params.push(options.limit);

  const sql =
    'SELECT word, pinyin, meaning, level, category, source FROM idioms ' +
    `${where} ORDER BY level ASC, word ASC ${limit}`;

  const [rows] = await pool.query<IdiomRow[]>(sql, params);
  return rows.map((row) => ({
    word: row.word,
    pinyin: row.pinyin,
    meaning: row.meaning,
    level: Number(row.level),
    category: row.category,
    // A row written before the source column was added can hold an empty
    // value. Never hand the client a blank attribution line.
    source: typeof row.source === 'string' && row.source.trim()
      ? row.source.trim()
      : PENDING_SOURCE,
  }));
}

/**
 * Count the idioms the table holds.
 *
 * A missing table counts as zero rather than throwing — the same rule the
 * seed runner uses, so a database that has not been migrated reads as
 * "nothing seeded" instead of "the query broke".
 */
export async function countIdioms(): Promise<number> {
  const pool = getPool();
  const [rows] = await pool.query<(RowDataPacket & { n: number })[]>(
    'SELECT COUNT(*) AS n FROM idioms',
  );
  return rows[0] ? Number(rows[0].n) : 0;
}
