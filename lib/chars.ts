import { cache } from 'react';
import type { RowDataPacket } from 'mysql2';
import { getPool } from './db';
import { readContentFromFs } from './content';
import { getPinyinIndex, resolvePinyin } from './pinyin-index';
import { getStrokeCount } from './stroke-count';
import type { Char, CharListResult, CharRow, CharWithRelated } from './chars-types';

const PAGE_SIZE = 80;
const RELATED_LIMIT = 8;

/** The value shapes mysql2 accepts as a bound SQL parameter. */
type SqlParam = string | number | bigint | boolean | Date | Buffer | null;

export interface ListCharsOpts {
  q?: string;
  letter?: string;
  radical?: string;
  level?: 1 | 2 | 3;
  /**
   * 2026-07-04: HSK 1-6 filter for /game progressive reveal. Only chars
   * with `chars.hsk_level === hskLevel` are returned. When undefined, the
   * existing chars.level filter (via `level` above) is the only filter.
   * NULL `hsk_level` chars are excluded (they fall under the fallback path
   * if the caller passes `level` alongside).
   */
  hskLevel?: 1 | 2 | 3 | 4 | 5 | 6;
  page?: number;
}

/** A raw `chars` row. Shared with lib/pinyin-index.ts. */
interface DbRow extends RowDataPacket, CharRow {}

/** The columns the 拼音接龙 pool query selects. */
interface ChainPoolRow extends RowDataPacket {
  char: string;
  level: 1 | 2 | 3;
  pinyin: string;
  radical: string;
  hsk_level: number | null;
}

interface CharCountRow extends RowDataPacket {
  n: number;
}

/**
 * Resolve pinyin for a char, preferring the DB value (populated by the
 * chars import). Falls back to pinyin-pro for chars with empty DB pinyin
 * (all of them, since the 2026-06-17 migration moved the data to
 * data/content/<char>.json).
 *
 * The implementation lives in lib/pinyin-index.ts so the reading shown on
 * the page and the reading the A-Z index buckets by are the same value.
 */

/**
 * Convert a DB row + JSON content into the public Char shape. Post 2026-06-17
 * migration the chars table only carries structural metadata; meaning /
 * pinyin_alt / variants are read from data/content/<char>.json.
 */
function hydrateChar(row: CharRow): Char {
  const content = readContentFromFs(row.char);
  const resolvedPinyin = resolvePinyin(row.char, row.pinyin);
  return {
    char: row.char,
    level: row.level,
    pinyin: resolvedPinyin,
    pinyinAlt: content?.dict?.pinyin_alt ?? [],
    radical: row.radical ?? '',
    // The DB column is 0 for every row since the 2026-06-17 migration; the
    // bundled stroke data knows the real count for the 87% of chars it covers.
    strokeCount: getStrokeCount(row.char) ?? row.stroke_count ?? 0,
    meaningZh: content?.dict?.meaning_zh ?? content?.meaning_zh ?? null,
    meaningEn: content?.dict?.meaning_en ?? null,
    unicodeCodepoint: row.unicode_codepoint ?? '',
    variants: content?.dict?.variants ?? [],
    // 2026-07-04: HSK level for /game progressive reveal. NULL = not yet
    // assigned by the HSK import; callers should fall back to chars.level.
    hskLevel: row.hsk_level ?? null,
  };
}

/**
 * Like hydrateChar but only returns the fields the game needs. Used by
 * getRandomChars which returns a smaller shape.
 */
function hydrateCharMinimal(row: CharRow): Pick<Char, 'char' | 'pinyin' | 'meaningZh'> {
  const content = readContentFromFs(row.char);
  return {
    char: row.char,
    pinyin: resolvePinyin(row.char, row.pinyin),
    meaningZh: content?.dict?.meaning_zh ?? content?.meaning_zh ?? null,
  };
}

/**
 * A row of the 拼音接龙 char pool. `meaningZh` is read from the content
 * JSON (the chars table only carries structural metadata since the
 * 2026-06-17 migration).
 */
export interface ChainCharPoolRow {
  char: string;
  pinyin: string;
  meaningZh: string | null;
  radical: string;
  level: 1 | 2 | 3;
  hskLevel: number | null;
}

/**
 * Fetch the 拼音接龙 char pool with a single SQL query.
 *
 * The endpoint used to page through listChars() up to 100 times — two SQL
 * round-trips per page, so ~200 queries per request — and then filtered the
 * rows in JS. The filters are pushed into SQL instead and the rows are read
 * in one shot; only the level / HSK membership is decided by the database.
 *
 * The meaning still comes from data/content/<char>.json, which is parsed
 * once per process and cached afterwards (see lib/content.ts).
 */
export async function listChainCharPool(opts: {
  /** chars.level values to keep. Empty = no level filter. */
  levels?: Array<1 | 2 | 3>;
  /** chars.hsk_level to keep. Takes precedence over `levels`. */
  hskLevel?: number;
  /** Safety cap on the number of rows. */
  limit?: number;
}): Promise<ChainCharPoolRow[]> {
  const where: string[] = [];
  const params: unknown[] = [];

  if (opts.hskLevel != null) {
    where.push('hsk_level = ?');
    params.push(opts.hskLevel);
  } else if (opts.levels && opts.levels.length > 0) {
    where.push(`level IN (${opts.levels.map(() => '?').join(',')})`);
    params.push(...opts.levels);
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const limit = Math.max(1, Math.min(20_000, opts.limit ?? 8_000));

  const pool = getPool();
  // `ORDER BY pinyin` was dropped: `chars.pinyin` is empty for every row
  // since the 2026-06-17 migration, so it only added a useless sort key.
  // The client shuffles the pool anyway, so a stable order by codepoint is
  // all that is needed.
  const [rows] = await pool.query<ChainPoolRow[]>(
    `SELECT \`char\`, level, pinyin, radical, hsk_level
     FROM chars
     ${whereSql}
     ORDER BY \`char\`
     LIMIT ?`,
    [...params, limit],
  );

  return rows.map((row) => {
    const content = readContentFromFs(row.char);
    return {
      char: row.char,
      pinyin: resolvePinyin(row.char, row.pinyin),
      meaningZh: content?.dict?.meaning_zh ?? content?.meaning_zh ?? null,
      radical: row.radical ?? '',
      level: row.level,
      hskLevel: row.hsk_level ?? null,
    };
  });
}

export async function listChars(opts: ListCharsOpts = {}): Promise<CharListResult> {
  const page = Math.max(1, opts.page ?? 1);
  const offset = (page - 1) * PAGE_SIZE;

  // The 按拼音 A-Z index filters on the reading, which no longer lives in
  // `chars.pinyin` — that column is empty for every row. The pinyin index
  // answers the filter directly, and it can order the bucket by reading
  // (the SQL path could only fall back to ordering by codepoint).
  if (opts.letter) return listCharsByLetter(opts, page, offset);

  const pool = getPool();

  const where: string[] = [];
  const params: SqlParam[] = [];

  // After the 2026-06-17 migration `pinyin` is empty for most chars in DB,
  // so the old `pinyin LIKE` search no longer returns anything useful.
  // For now we only support exact single-char match.
  if (opts.q) {
    where.push('`char` = ?');
    params.push(opts.q);
  }
  if (opts.radical) {
    where.push('radical = ?');
    params.push(opts.radical);
  }
  if (opts.level) {
    where.push('level = ?');
    params.push(opts.level);
  }
  if (opts.hskLevel) {
    // 2026-07-04: HSK progressive reveal filter. NULL hsk_level chars are
    // excluded — callers needing the fallback path should call listChars
    // without `hskLevel` and filter on `level` instead.
    where.push('hsk_level = ?');
    params.push(opts.hskLevel);
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  const [rows] = await pool.query<DbRow[]>(
    `SELECT \`char\`, level, pinyin, radical, stroke_count, unicode_codepoint, hsk_level
     FROM chars
     ${whereSql}
     ORDER BY \`char\`
     LIMIT ? OFFSET ?`,
    [...params, PAGE_SIZE, offset],
  );

  const [countRows] = await pool.query<CharCountRow[]>(
    `SELECT COUNT(*) AS n FROM chars ${whereSql}`,
    params,
  );

  return {
    chars: rows.map(hydrateChar),
    total: countRows[0].n,
    page,
    pageSize: PAGE_SIZE,
  };
}

/**
 * The 按拼音 bucket: every char whose reading starts with `opts.letter`.
 *
 * The filtering happens in JS against the pinyin index because the reading
 * does not live in the database any more. The index already holds the rows,
 * so the extra cost is one map lookup plus the hydration of the 80 chars
 * that end up on this page.
 */
async function listCharsByLetter(
  opts: ListCharsOpts,
  page: number,
  offset: number,
): Promise<CharListResult> {
  const index = await getPinyinIndex();
  const letter = opts.letter!.toUpperCase();
  const candidates = index.byLetter.get(letter) ?? [];

  const filtered = candidates.filter((char) => {
    const row = index.rows.get(char);
    if (!row) return false;
    if (opts.q && char !== opts.q) return false;
    if (opts.radical && row.radical !== opts.radical) return false;
    if (opts.level && row.level !== opts.level) return false;
    if (opts.hskLevel && row.hsk_level !== opts.hskLevel) return false;
    return true;
  });

  const pageRows = filtered
    .slice(offset, offset + PAGE_SIZE)
    .map((char) => index.rows.get(char))
    .filter((row): row is CharRow => row !== undefined);

  return {
    chars: pageRows.map(hydrateChar),
    total: filtered.length,
    page,
    pageSize: PAGE_SIZE,
  };
}

/**
 * Look up a single character.
 *
 * Wrapped in React's `cache()` so that the several lookups of one request
 * share a single database roundtrip: the dictionary page reads the char for
 * its metadata and again for the detail view, and `getCharDetail` reads it
 * once more. Outside a React request the call simply runs as before.
 */
export const getChar = cache(async (char: string): Promise<Char | null> => {
  // Filter to BMP-only at the application boundary: mysql2 binary protocol
  // corrupts 4-byte UTF-8 params (supp-plane chars). Returning null here
  // means the corrupted value never reaches the driver. Callers that need
  // to distinguish "supp-plane unsupported" from "genuinely missing" should
  // check `isSuppPlaneChar(char)` first.
  if (!char || (char.codePointAt(0) ?? 0) > 0xffff) return null;
  const pool = getPool();
  const [rows] = await pool.query<DbRow[]>(
    `SELECT \`char\`, level, pinyin, radical, stroke_count, unicode_codepoint, hsk_level
     FROM chars
     WHERE \`char\` = ?
     LIMIT 1`,
    [char],
  );
  if (rows.length === 0) return null;
  return hydrateChar(rows[0]);
});

/**
 * True if the input is a non-empty 4-byte UTF-8 character (codepoint > U+FFFF,
 * e.g. CJK Extension B/C/D…). These cannot be queried through the mysql2
 * binary protocol without corruption, so getChar() returns null for them.
 * Pages can use this to show a soft empty state instead of a generic 404.
 */
export function isSuppPlaneChar(char: string): boolean {
  if (!char) return false;
  const cp = char.codePointAt(0);
  return cp !== undefined && cp > 0xffff;
}

export async function getCharDetail(char: string): Promise<CharWithRelated | null> {
  const base = await getChar(char);
  if (!base) return null;
  const pool = getPool();

  // Related-by-radical uses DB radical, which is populated by chars import.
  const [radicalRows] = await pool.query<DbRow[]>(
    `SELECT \`char\`, level, pinyin, radical, stroke_count, unicode_codepoint, hsk_level
     FROM chars
     WHERE radical = ? AND \`char\` != ?
     ORDER BY stroke_count
     LIMIT ?`,
    [base.radical, char, RELATED_LIMIT],
  );

  // Related-by-pinyin: `chars.pinyin` is empty for every row since the
  // 2026-06-17 content migration, so the old `WHERE pinyin = ?` query could
  // never match and the row was disabled outright. The pinyin index answers
  // it instead, bucketed by the same reading the 拼音 field displays.
  const index = await getPinyinIndex();
  const samePinyin = (index.byReading.get(base.pinyin) ?? []).filter((c) => c !== char);
  const pinyinRows = samePinyin
    .slice(0, RELATED_LIMIT)
    .map((c) => index.rows.get(c))
    .filter((row): row is CharRow => row !== undefined);

  return {
    ...base,
    // The DB column is 0 for every row; the stroke data knows the real count
    // for the 87% of chars that have it.
    strokeCount: getStrokeCount(char) ?? base.strokeCount,
    relatedByRadical: radicalRows.map(hydrateChar),
    relatedByPinyin: pinyinRows.map(hydrateChar),
  };
}

const DIFFICULTY_LEVELS: Record<'easy' | 'medium' | 'hard', number[]> = {
  easy: [1],
  medium: [1, 2],
  hard: [1, 2, 3],
};

export async function getRandomChars(opts: {
  count: number;
  difficulty: 'easy' | 'medium' | 'hard';
}): Promise<Pick<Char, 'char' | 'pinyin' | 'meaningZh'>[]> {
  const levels = DIFFICULTY_LEVELS[opts.difficulty];
  const placeholders = levels.map(() => '?').join(',');
  const pool = getPool();
  // Note: `LENGTH(char) = 3` filters to BMP-only chars (3 bytes in UTF-8).
  // The previous `REGEXP '^[一-鿿]$'` filter failed because MySQL's REGEXP
  // `$` anchor doesn't align with multi-byte char boundaries.
  const [rows] = await pool.query<DbRow[]>(
    `SELECT \`char\`, level, pinyin, radical, stroke_count, unicode_codepoint, hsk_level
     FROM chars
     WHERE level IN (${placeholders})
       AND LENGTH(\`char\`) = 3
     ORDER BY RAND()
     LIMIT ?`,
    [...levels, opts.count],
  );
  return rows.map(hydrateCharMinimal);
}
