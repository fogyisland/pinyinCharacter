import { getPool } from './db';
import type { Char, CharListResult } from './chars-types';

const PAGE_SIZE = 80;

export interface ListCharsOpts {
  q?: string;
  letter?: string;
  radical?: string;
  level?: 1 | 2 | 3;
  page?: number;
}

function mapRow(row: any): Char {
  return {
    char: row.char,
    level: row.level,
    pinyin: row.pinyin ?? '',
    pinyinAlt: row.pinyin_alt ? JSON.parse(row.pinyin_alt) : [],
    radical: row.radical ?? '',
    strokeCount: row.stroke_count ?? 0,
    meaningZh: row.meaning_zh,
    meaningEn: row.meaning_en,
    unicodeCodepoint: row.unicode_codepoint,
    variants: row.variants ? JSON.parse(row.variants) : [],
  };
}

export async function listChars(opts: ListCharsOpts = {}): Promise<CharListResult> {
  const pool = getPool();
  const page = Math.max(1, opts.page ?? 1);
  const offset = (page - 1) * PAGE_SIZE;

  const where: string[] = [];
  const params: any[] = [];

  if (opts.q) {
    where.push('(pinyin LIKE ? OR `char` = ? OR meaning_en LIKE ?)');
    params.push(`%${opts.q}%`, opts.q, `%${opts.q}%`);
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

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  const [rows] = await pool.query<any[]>(
    `SELECT \`char\`, level, pinyin, pinyin_alt, radical, stroke_count, meaning_zh, meaning_en, unicode_codepoint, variants
     FROM chars
     ${whereSql}
     ORDER BY pinyin, \`char\`
     LIMIT ? OFFSET ?`,
    [...params, PAGE_SIZE, offset]
  );

  const [countRows] = await pool.query<any[]>(
    `SELECT COUNT(*) AS n FROM chars ${whereSql}`,
    params
  );

  return {
    chars: rows.map(mapRow),
    total: countRows[0].n,
    page,
    pageSize: PAGE_SIZE,
  };
}
