import { createHash } from 'crypto';
import { getPool } from './db';
import { readContentFromFs } from './content';

export interface RareChar {
  char: string;
  pinyin: string;
  meaning: string;
  story: string;
  needsReview: boolean;
  generatedBy: string | null;
  generatedAt: Date | null;
  createdAt: Date;
}

export interface ListResult {
  chars: RareChar[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Pick a deterministic char from the list for the given date string.
 * Same date → same char; different date → different char (most of the time).
 */
export function pickDailyChar(chars: string[], dateStr: string): string {
  if (chars.length === 0) throw new Error('chars list is empty');
  const hash = createHash('sha1').update(dateStr).digest('hex').slice(0, 8);
  const idx = parseInt(hash, 16) % chars.length;
  return chars[idx];
}

/**
 * Build a WHERE clause + params for the search API.
 * - empty query: no filter
 * - single char: exact match on `char`
 * - otherwise: LIKE on `pinyin`
 */
export function buildSearchWhere(q: string): { where: string; params: string[] } {
  if (!q) return { where: '', params: [] };
  if (isSingleChar(q)) return { where: 'WHERE `char` = ?', params: [q] };
  return { where: 'WHERE pinyin LIKE ?', params: [`%${q}%`] };
}

export function isSingleChar(s: string): boolean {
  if (!s) return false;
  const arr = Array.from(s);
  return arr.length === 1 && arr[0]!.codePointAt(0)! >= 0x4e00;
}

interface DbContentRow {
  meaning: string | null;
  story: string | null;
  generated_by: string | null;
  generated_at: Date | null;
  created_at: Date | null;
}

/**
 * Read content (meaning/story/generated_*) for a single rare char.
 * Prefers data/content/<char>.json; falls back to legacy DB columns
 * during the migration window. Wrapped in try/catch so it survives
 * post-migration DBs that no longer have the columns.
 */
async function readRareContent(char: string): Promise<DbContentRow> {
  // 1. JSON first — universal etymology_story (covers all 7910 chars, primary
  //    source for /stories as of 2026-06-18). Fall back to legacy L3-only
  //    blocks for chars that don't have etymology yet.
  const content = readContentFromFs(char);
  if (content?.etymology?.story) {
    return {
      meaning: content.rare?.meaning ?? null,
      story: content.etymology.story,
      generated_by: content.etymology.generated_by ?? null,
      generated_at: content.etymology.generated_at ? new Date(content.etymology.generated_at) : null,
      created_at: null,
    };
  }
  if (content?.rare) {
    return {
      meaning: content.rare.meaning ?? null,
      story: content.rare.story ?? null,
      generated_by: content.rare.generated_by ?? null,
      generated_at: content.rare.generated_at ? new Date(content.rare.generated_at) : null,
      created_at: null,
    };
  }
  // 2. DB fallback (legacy cols may have been dropped)
  try {
    const pool = getPool();
    const [rows] = await pool.execute<any[]>(
      `SELECT meaning, story, generated_by, generated_at, created_at
       FROM rare_chars WHERE \`char\` = ? LIMIT 1`,
      [char]
    );
    if (rows.length === 0) {
      return { meaning: null, story: null, generated_by: null, generated_at: null, created_at: null };
    }
    return rows[0];
  } catch {
    return { meaning: null, story: null, generated_by: null, generated_at: null, created_at: null };
  }
}

function hydrate(char: string, pinyin: string, needsReview: boolean, db: DbContentRow): RareChar {
  return {
    char,
    pinyin,
    meaning: db.meaning ?? '',
    story: db.story ?? '',
    needsReview,
    generatedBy: db.generated_by ?? null,
    generatedAt: db.generated_at ?? null,
    createdAt: db.created_at ?? new Date(0),
  };
}

export async function listChars(opts: { q?: string; page?: number; minMeaning?: boolean } = {}): Promise<ListResult> {
  const pool = getPool();
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = 80;
  const offset = (page - 1) * pageSize;
  const { where, params } = buildSearchWhere(opts.q ?? '');

  // minMeaning filter is now approximate: we filter on whether the JSON file
  // exists at all (cheap existence check), then hydrate content for the
  // returned rows. For legacy DB-only installs, falls back to DB meaning<>''.
  const filters: string[] = [];
  if (where) filters.push(where.replace(/^WHERE\s+/, ''));
  if (opts.minMeaning) filters.push("(meaning <> '' OR meaning IS NOT NULL)");
  const finalWhere = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

  // Structural cols only — content (meaning/story) hydrated from JSON.
  const [rows] = await pool.query<any[]>(
    `SELECT \`char\`, pinyin, needs_review FROM rare_chars ${finalWhere}
     ORDER BY \`char\` ASC LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  );

  const [[{ total }]] = await pool.query<any[]>(
    `SELECT COUNT(*) AS total FROM rare_chars ${finalWhere}`,
    params
  );

  // Hydrate content for each row in parallel.
  const hydrated = await Promise.all(
    (rows as Array<{ char: string; pinyin: string; needs_review: number | boolean }>).map(async (r) => {
      const db = await readRareContent(r.char);
      return hydrate(r.char, r.pinyin, Boolean(r.needs_review), db);
    })
  );

  return {
    chars: hydrated,
    total: Number(total),
    page,
    pageSize,
  };
}

export async function getChar(c: string): Promise<RareChar | null> {
  const pool = getPool();
  const [rows] = await pool.execute<any[]>(
    `SELECT \`char\`, pinyin, needs_review FROM rare_chars WHERE \`char\` = ? LIMIT 1`,
    [c]
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  const db = await readRareContent(c);
  return hydrate(r.char, r.pinyin, Boolean(r.needs_review), db);
}

export async function getDailyChar(dateStr: string): Promise<{
  char: string;
  pinyin: string;
  meaning: string;
  story: string;
  date: string;
} | null> {
  const pool = getPool();
  const [rows] = await pool.execute<any[]>(
    `SELECT \`char\`, pinyin FROM rare_chars ORDER BY \`char\` ASC LIMIT 5000`
  );
  if (rows.length === 0) return null;
  const chars = rows.map((r) => r.char as string);
  const picked = pickDailyChar(chars, dateStr);
  const found = rows.find((r) => r.char === picked);
  if (!found) return null;
  const db = await readRareContent(found.char);
  return {
    char: found.char,
    pinyin: found.pinyin,
    meaning: db.meaning ?? '',
    story: db.story ?? '',
    date: dateStr,
  };
}

export async function getRandomStoryChar(): Promise<RareChar | null> {
  // Pick a random char from the full chars table (any level). Story now comes
  // from the universal etymology_story (7910/7910) rather than the L3-only
  // rare_chars.story. L3 chars often have empty pinyin in chars table — left
  // join rare_chars to fall back.
  const pool = getPool();
  const [rows] = await pool.query<any[]>(
    `SELECT c.\`char\`, c.pinyin AS c_pinyin, r.pinyin AS r_pinyin, c.level
     FROM chars c
     LEFT JOIN rare_chars r ON c.\`char\` COLLATE utf8mb4_unicode_ci = r.\`char\` COLLATE utf8mb4_unicode_ci
     ORDER BY RAND() LIMIT ?`,
    [1]
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  const pinyin = r.c_pinyin || r.r_pinyin || '';
  const db = await readRareContent(r.char);
  if (!db.story) return null;
  return hydrate(r.char, pinyin, false, db);
}