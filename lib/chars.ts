import { pinyin } from 'pinyin-pro';
import { getPool } from './db';
import { readContentFromFs } from './content';
import type { Char, CharListResult, CharWithRelated } from './chars-types';

const PAGE_SIZE = 80;
const RELATED_LIMIT = 8;

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

interface DbRow {
  char: string;
  level: 1 | 2 | 3;
  pinyin: string;
  radical: string;
  stroke_count: number;
  unicode_codepoint: string;
  // 2026-07-04: HSK 1-6 level from chars.hsk_level (NULL = not yet assigned).
  // Optional so it stays backward compatible if the migration hasn't run.
  hsk_level?: number | null;
}

const pinyinCache = new Map<string, string>();

/**
 * Resolve pinyin for a char, preferring the DB value (populated by the
 * chars import). Falls back to pinyin-pro for chars with empty DB pinyin
 * (most L1/L2/L3 chars after the 2026-06-17 migration dropped the
 * LLM-generated pinyin_alt column). Cached per process to keep list pages
 * cheap.
 */
function resolvePinyin(char: string, dbPinyin: string | null | undefined): string {
  if (dbPinyin && dbPinyin.trim()) return dbPinyin.trim();
  const cached = pinyinCache.get(char);
  if (cached) return cached;
  const generated = pinyin(char, { toneType: 'symbol' }).trim();
  pinyinCache.set(char, generated);
  return generated;
}

/**
 * Convert a DB row + JSON content into the public Char shape. Post 2026-06-17
 * migration the chars table only carries structural metadata; meaning /
 * pinyin_alt / variants are read from data/content/<char>.json.
 */
function hydrateChar(row: DbRow): Char {
  const content = readContentFromFs(row.char);
  const resolvedPinyin = resolvePinyin(row.char, row.pinyin);
  return {
    char: row.char,
    level: row.level,
    pinyin: resolvedPinyin,
    pinyinAlt: content?.dict?.pinyin_alt ?? [],
    radical: row.radical ?? '',
    strokeCount: row.stroke_count ?? 0,
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
function hydrateCharMinimal(row: DbRow): Pick<Char, 'char' | 'pinyin' | 'meaningZh'> {
  const content = readContentFromFs(row.char);
  return {
    char: row.char,
    pinyin: resolvePinyin(row.char, row.pinyin),
    meaningZh: content?.dict?.meaning_zh ?? content?.meaning_zh ?? null,
  };
}

export async function listChars(opts: ListCharsOpts = {}): Promise<CharListResult> {
  const pool = getPool();
  const page = Math.max(1, opts.page ?? 1);
  const offset = (page - 1) * PAGE_SIZE;

  const where: string[] = [];
  const params: any[] = [];

  // After the 2026-06-17 migration `pinyin` is empty for most chars in DB,
  // so the old `pinyin LIKE` search no longer returns anything useful.
  // For now we only support exact single-char match. The `letter` filter
  // (used by pinyin-bucketed dictionary views) is similarly degraded.
  if (opts.q) {
    where.push('`char` = ?');
    params.push(opts.q);
  }
  if (opts.letter) {
    where.push('pinyin LIKE ?');
    params.push(`${opts.letter}%`);
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

  const [rows] = await pool.query<any[]>(
    `SELECT \`char\`, level, pinyin, radical, stroke_count, unicode_codepoint, hsk_level
     FROM chars
     ${whereSql}
     ORDER BY pinyin, \`char\`
     LIMIT ? OFFSET ?`,
    [...params, PAGE_SIZE, offset],
  );

  const [countRows] = await pool.query<any[]>(
    `SELECT COUNT(*) AS n FROM chars ${whereSql}`,
    params,
  );

  return {
    chars: (rows as DbRow[]).map(hydrateChar),
    total: countRows[0].n,
    page,
    pageSize: PAGE_SIZE,
  };
}

export async function getChar(char: string): Promise<Char | null> {
  // Filter to BMP-only at the application boundary: mysql2 binary protocol
  // corrupts 4-byte UTF-8 params (supp-plane chars). Returning null here
  // means the corrupted value never reaches the driver. Callers that need
  // to distinguish "supp-plane unsupported" from "genuinely missing" should
  // check `isSuppPlaneChar(char)` first.
  if (!char || (char.codePointAt(0) ?? 0) > 0xFFFF) return null;
  const pool = getPool();
  const [rows] = await pool.query<any[]>(
    `SELECT \`char\`, level, pinyin, radical, stroke_count, unicode_codepoint, hsk_level
     FROM chars
     WHERE \`char\` = ?
     LIMIT 1`,
    [char],
  );
  if (rows.length === 0) return null;
  return hydrateChar(rows[0] as DbRow);
}

/**
 * True if the input is a non-empty 4-byte UTF-8 character (codepoint > U+FFFF,
 * e.g. CJK Extension B/C/D…). These cannot be queried through the mysql2
 * binary protocol without corruption, so getChar() returns null for them.
 * Pages can use this to show a soft empty state instead of a generic 404.
 */
export function isSuppPlaneChar(char: string): boolean {
  if (!char) return false;
  const cp = char.codePointAt(0);
  return cp !== undefined && cp > 0xFFFF;
}

export async function getCharDetail(char: string): Promise<CharWithRelated | null> {
  const base = await getChar(char);
  if (!base) return null;
  const pool = getPool();

  // Related-by-radical uses DB radical, which is populated by chars import.
  const [radicalRows] = await pool.query<any[]>(
    `SELECT \`char\`, level, pinyin, radical, stroke_count, unicode_codepoint, hsk_level
     FROM chars
     WHERE radical = ? AND \`char\` != ?
     ORDER BY stroke_count
     LIMIT ?`,
    [base.radical, char, RELATED_LIMIT],
  );

  // Related-by-pinyin: since most chars have empty DB pinyin, this would
  // typically return nothing. Skip the SQL roundtrip — pinyin-bucketed
  // "related" views are disabled for now.
  void base.pinyin;
  return {
    ...base,
    relatedByRadical: (radicalRows as DbRow[]).map(hydrateChar),
    relatedByPinyin: [],
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
  const [rows] = await pool.query<any[]>(
    `SELECT \`char\`, level, pinyin, radical, stroke_count, unicode_codepoint, hsk_level
     FROM chars
     WHERE level IN (${placeholders})
       AND LENGTH(\`char\`) = 3
     ORDER BY RAND()
     LIMIT ?`,
    [...levels, opts.count],
  );
  return (rows as DbRow[]).map(hydrateCharMinimal);
}
