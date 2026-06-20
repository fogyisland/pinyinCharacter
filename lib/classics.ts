import 'server-only';
import { getPool } from './db';
import type {
  ClassicCategory,
  ClassicChunk,
  ClassicDetail,
  ClassicListItem,
  ClassicListResult,
} from './classics-types';
import { stripPunct } from './punctuation';

const PAGE_SIZE = 12;

export interface ListClassicsArgs {
  category?: ClassicCategory;
  q?: string;
  page?: number;
  pageSize?: number;
}

function buildWhereClause(args: ListClassicsArgs): { where: string; params: unknown[] } {
  const parts: string[] = [];
  const params: unknown[] = [];
  if (args.category) {
    parts.push('category = ?');
    params.push(args.category);
  }
  if (args.q && args.q.trim()) {
    parts.push('title LIKE ?');
    params.push(`%${args.q.trim()}%`);
  }
  const where = parts.length === 0 ? '' : `WHERE ${parts.join(' AND ')}`;
  return { where, params };
}

function parseChunks(raw: unknown): ClassicChunk[] {
  const arr: ClassicChunk[] = typeof raw === 'string' ? JSON.parse(raw) : (raw as ClassicChunk[]);
  return arr.map((c, i) => ({ id: c.id ?? i + 1, label: String(c.label ?? ''), content: c.content ?? [], pinyin: c.pinyin ?? [] }));
}

function computeCharCount(chunks: ClassicChunk[]): number {
  return chunks.reduce(
    (sum, c) => sum + c.content.reduce((s, line) => s + Array.from(stripPunct(line)).length, 0),
    0,
  );
}

function mapListRow(r: { id: number; slug: string; title: string; category: ClassicCategory; author: string | null; era: string | null; chunks: unknown }): ClassicListItem {
  const chunks = parseChunks(r.chunks);
  return {
    id: Number(r.id),
    slug: r.slug,
    title: r.title,
    category: r.category,
    author: r.author,
    era: r.era,
    chunkCount: chunks.length,
    charCount: computeCharCount(chunks),
  };
}

export async function listClassics(args: ListClassicsArgs = {}): Promise<ClassicListResult> {
  const pool = getPool();
  const page = Math.max(1, args.page ?? 1);
  const pageSize = Math.max(1, Math.min(50, args.pageSize ?? PAGE_SIZE));
  const offset = (page - 1) * pageSize;
  const { where, params } = buildWhereClause(args);

  const sql = `SELECT id, slug, title, category, author, era, chunks FROM classics
               ${where}
               ORDER BY id ASC
               LIMIT ? OFFSET ?`;
  const [rows] = await pool.query<any[]>(sql, [...params, pageSize, offset]);
  const [[{ total }]] = await pool.query<any[]>(
    `SELECT COUNT(*) AS total FROM classics ${where}`,
    params,
  );

  return {
    items: (rows as any[]).map(mapListRow),
    total: Number(total),
    page,
    pageSize,
  };
}

export async function getClassicBySlug(slug: string): Promise<ClassicDetail | null> {
  const pool = getPool();
  const [rows] = await pool.query<any[]>(
    `SELECT id, slug, title, category, author, era, chunks FROM classics WHERE slug = ? LIMIT 1`,
    [slug],
  );
  const row = (rows as any[])[0];
  if (!row) return null;
  const chunks = parseChunks(row.chunks);
  return {
    id: Number(row.id),
    slug: row.slug,
    title: row.title,
    category: row.category,
    author: row.author,
    era: row.era,
    chunks,
  };
}

export async function countByCategory(): Promise<Record<ClassicCategory, number>> {
  const pool = getPool();
  const [rows] = await pool.query<any[]>(
    `SELECT category, COUNT(*) AS n FROM classics GROUP BY category`,
  );
  const map: Record<ClassicCategory, number> = {
    'four-books': 0,
    'five-classics': 0,
    mengxue: 0,
    philosophy: 0,
    history: 0,
    other: 0,
  };
  for (const r of rows as any[]) {
    map[r.category as ClassicCategory] = Number(r.n);
  }
  return map;
}
