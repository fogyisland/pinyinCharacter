import { getPool } from './db';
import type { Char, CharListResult, CharWithRelated } from './chars-types';

const PAGE_SIZE = 80;
const RELATED_LIMIT = 8;

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

export async function getChar(char: string): Promise<Char | null> {
  const pool = getPool();
  const [rows] = await pool.query<any[]>(
    `SELECT \`char\`, level, pinyin, pinyin_alt, radical, stroke_count, meaning_zh, meaning_en, unicode_codepoint, variants
     FROM chars
     WHERE \`char\` = ?
     LIMIT 1`,
    [char]
  );
  return rows.length > 0 ? mapRow(rows[0]) : null;
}

export async function getCharDetail(char: string): Promise<CharWithRelated | null> {
  const base = await getChar(char);
  if (!base) return null;
  const pool = getPool();
  const [radicalRows] = await pool.query<any[]>(
    `SELECT \`char\`, level, pinyin, pinyin_alt, radical, stroke_count, meaning_zh, meaning_en, unicode_codepoint, variants
     FROM chars
     WHERE radical = ? AND \`char\` != ?
     ORDER BY stroke_count
     LIMIT ?`,
    [base.radical, char, RELATED_LIMIT]
  );
  const [pinyinRows] = await pool.query<any[]>(
    `SELECT \`char\`, level, pinyin, pinyin_alt, radical, stroke_count, meaning_zh, meaning_en, unicode_codepoint, variants
     FROM chars
     WHERE pinyin = ? AND \`char\` != ?
     ORDER BY \`char\`
     LIMIT ?`,
    [base.pinyin, char, RELATED_LIMIT]
  );
  return {
    ...base,
    relatedByRadical: radicalRows.map(mapRow),
    relatedByPinyin: pinyinRows.map(mapRow),
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
    `SELECT \`char\`, pinyin, meaning_zh
     FROM chars
     WHERE level IN (${placeholders})
       AND LENGTH(\`char\`) = 3
     ORDER BY RAND()
     LIMIT ?`,
    [...levels, opts.count],
  );
  return rows.map(r => ({
    char: r.char,
    pinyin: r.pinyin ?? '',
    meaningZh: r.meaning_zh,
  }));
}
