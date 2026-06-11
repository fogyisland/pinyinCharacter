import { createHash } from 'crypto';
import { getPool } from './db';

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

export async function listChars(opts: { q?: string; page?: number } = {}): Promise<ListResult> {
  const pool = getPool();
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = 80;
  const offset = (page - 1) * pageSize;
  const { where, params } = buildSearchWhere(opts.q ?? '');

  const [rows] = await pool.query<any[]>(
    `SELECT \`char\`, pinyin, meaning, story, needs_review, generated_by, generated_at, created_at
     FROM rare_chars ${where}
     ORDER BY \`char\` ASC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  );

  const [[{ total }]] = await pool.query<any[]>(
    `SELECT COUNT(*) AS total FROM rare_chars ${where}`,
    params
  );

  return {
    chars: rows.map(mapRow),
    total: Number(total),
    page,
    pageSize,
  };
}

export async function getChar(c: string): Promise<RareChar | null> {
  const pool = getPool();
  const [rows] = await pool.execute<any[]>(
    `SELECT \`char\`, pinyin, meaning, story, needs_review, generated_by, generated_at, created_at
     FROM rare_chars WHERE \`char\` = ? LIMIT 1`,
    [c]
  );
  return rows.length > 0 ? mapRow(rows[0]) : null;
}

export async function getAllChars(): Promise<string[]> {
  const pool = getPool();
  const [rows] = await pool.query<any[]>(
    `SELECT \`char\` FROM rare_chars WHERE meaning <> '' ORDER BY \`char\` ASC`
  );
  return rows.map((r) => r.char as string);
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
    `SELECT \`char\`, pinyin, meaning, story
     FROM rare_chars WHERE meaning <> '' ORDER BY \`char\` ASC LIMIT 5000`
  );
  if (rows.length === 0) return null;
  const chars = rows.map((r) => r.char as string);
  const picked = pickDailyChar(chars, dateStr);
  const found = rows.find((r) => r.char === picked);
  return {
    char: found!.char,
    pinyin: found!.pinyin,
    meaning: found!.meaning,
    story: found!.story,
    date: dateStr,
  };
}

function mapRow(r: any): RareChar {
  return {
    char: r.char,
    pinyin: r.pinyin,
    meaning: r.meaning,
    story: r.story,
    needsReview: Boolean(r.needs_review),
    generatedBy: r.generated_by ?? null,
    generatedAt: r.generated_at ?? null,
    createdAt: r.created_at,
  };
}
