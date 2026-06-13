import { getPool } from './db';
import type { Dynasty, PoemDetail, PoemListItem, PoemListResult } from './poetry-types';

const PAGE_SIZE = 24;

export interface ListPoemsArgs {
  dynasty: Dynasty;
  q?: string;
  page?: number;
  pageSize?: number;
}

export function buildSearchWhere(q: string): { where: string; params: string[] } {
  const trimmed = (q ?? '').trim();
  if (!trimmed) return { where: '', params: [] };
  const firstChar = Array.from(trimmed)[0] ?? '';
  return {
    where: 'WHERE (title LIKE ? OR author LIKE ? OR title LIKE ?)',
    params: [`%${trimmed}%`, `%${trimmed}%`, `%${firstChar}%`],
  };
}

function mapRow(r: any): PoemListItem {
  return {
    id: Number(r.id),
    title: r.title,
    author: r.author,
    dynasty: r.dynasty,
    form: r.form ?? null,
  };
}

export async function listPoems(args: ListPoemsArgs): Promise<PoemListResult> {
  const pool = getPool();
  const page = Math.max(1, args.page ?? 1);
  const pageSize = Math.max(1, Math.min(PAGE_SIZE, args.pageSize ?? PAGE_SIZE));
  const offset = (page - 1) * pageSize;
  const { where, params } = buildSearchWhere(args.q ?? '');

  const sql = `SELECT id, title, author, dynasty, form FROM poems
               WHERE dynasty = ? ${where ? 'AND ' + where.replace(/^WHERE\s+/, '') : ''}
               ORDER BY id ASC
               LIMIT ? OFFSET ?`;

  const [rows] = await pool.query<any[]>(sql, [args.dynasty, ...params, pageSize, offset]);
  const [[{ total }]] = await pool.query<any[]>(
    `SELECT COUNT(*) AS total FROM poems
     WHERE dynasty = ? ${where ? 'AND ' + where.replace(/^WHERE\s+/, '') : ''}`,
    [args.dynasty, ...params]
  );

  return {
    items: (rows as any[]).map(mapRow),
    total: Number(total),
    page,
    pageSize,
  };
}

function parseJsonArray<T>(s: any, fallback: T): T {
  // mysql2 by default auto-parses JSON columns to JS values, so `s` may
  // already be the parsed array (not a string). Accept both shapes.
  if (Array.isArray(s)) return s as T;
  if (typeof s === 'string') {
    try {
      const v = JSON.parse(s);
      return Array.isArray(v) ? (v as T) : fallback;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

function mapDetailRow(r: any): PoemDetail {
  return {
    ...mapRow(r),
    content: parseJsonArray<string[]>(r.content, []),
    pinyin: parseJsonArray<string[][]>(r.pinyin, []),
    appreciation: r.appreciation ?? null,
  };
}

export async function getPoem(id: number): Promise<PoemDetail | null> {
  const pool = getPool();
  const [rows] = await pool.execute<any[]>(
    `SELECT id, title, author, dynasty, form, content, pinyin, appreciation
     FROM poems WHERE id = ? LIMIT 1`,
    [id]
  );
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return mapDetailRow((rows as any[])[0]);
}

export async function getRandomPoem(): Promise<PoemDetail | null> {
  const pool = getPool();
  const [rows] = await pool.query<any[]>(
    `SELECT id, title, author, dynasty, form, content, pinyin, appreciation
     FROM poems ORDER BY RAND() LIMIT 1`
  );
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return mapDetailRow((rows as any[])[0]);
}
