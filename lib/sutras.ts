import { getPool } from './db';
import type { SutraListItem, SutraListResult, SutraChunk, SutraChunkNoPinyin, SutraDetail } from './sutra-types';

const PIN_MARKER_RE = /第[一二三四五六七八九十百千零〇]+品|分第[一二三四五六七八九十百千零〇]+/;

/**
 * Split a sutra's paragraphs into chunks based on 品 markers.
 * - If a paragraph starts with "第X品..." (e.g. 法会因由分第一), a new chunk begins.
 * - Otherwise, all paragraphs fold into a single chunk labelled by the sutra title.
 */
export function splitIntoChunks(title: string, paragraphs: string[]): SutraChunkNoPinyin[] {
  if (paragraphs.length === 0) return [];

  const chunks: SutraChunkNoPinyin[] = [];
  let current: { label: string; content: string[] } | null = null;

  const hasMarker = paragraphs.some((p) => PIN_MARKER_RE.test(p));

  for (const para of paragraphs) {
    if (PIN_MARKER_RE.test(para)) {
      if (current) chunks.push({ id: chunks.length, ...current });
      current = { label: para.slice(0, 32), content: [para] };
    } else {
      if (!current) current = { label: hasMarker ? para.slice(0, 32) : title, content: [para] };
      else current.content.push(para);
    }
  }
  if (current) chunks.push({ id: chunks.length, ...current });

  return chunks;
}

const PAGE_SIZE = 12;

export interface ListSutrasArgs {
  q?: string;
  page?: number;
  pageSize?: number;
}

function buildSearchWhere(q: string): { where: string; params: string[] } {
  const trimmed = (q ?? '').trim();
  if (!trimmed) return { where: '', params: [] };
  return {
    where: 'WHERE title LIKE ?',
    params: [`%${trimmed}%`],
  };
}

interface RawSutraRow {
  id: number;
  title: string;
  slug: string;
  chunks: string | SutraChunk[];
  source: string | null;
}

function mapListRow(r: RawSutraRow): SutraListItem {
  const chunks = typeof r.chunks === 'string' ? (JSON.parse(r.chunks) as SutraChunk[]) : r.chunks;
  const charCount = chunks.reduce(
    (sum, c) => sum + c.content.reduce((s, line) => s + Array.from(line).length, 0),
    0
  );
  return {
    id: Number(r.id),
    title: r.title,
    slug: r.slug,
    chunkCount: chunks.length,
    charCount,
  };
}

export async function listSutras(args: ListSutrasArgs = {}): Promise<SutraListResult> {
  const pool = getPool();
  const page = Math.max(1, args.page ?? 1);
  const pageSize = Math.max(1, Math.min(PAGE_SIZE, args.pageSize ?? PAGE_SIZE));
  const offset = (page - 1) * pageSize;
  const { where, params } = buildSearchWhere(args.q ?? '');

  const sql = `SELECT id, title, slug, chunks FROM sutras
               ${where}
               ORDER BY id ASC
               LIMIT ? OFFSET ?`;
  const [rows] = await pool.query<any[]>(sql, [...params, pageSize, offset]);
  const [[{ total }]] = await pool.query<any[]>(
    `SELECT COUNT(*) AS total FROM sutras ${where}`,
    params
  );

  return {
    items: (rows as RawSutraRow[]).map(mapListRow),
    total: Number(total),
    page,
    pageSize,
  };
}

export async function getSutra(id: number): Promise<SutraDetail | null> {
  const pool = getPool();
  const [rows] = await pool.query<any[]>(
    `SELECT id, title, slug, chunks FROM sutras WHERE id = ? LIMIT 1`,
    [id]
  );
  const row = rows[0] as RawSutraRow | undefined;
  if (!row) return null;

  const rawChunks = typeof row.chunks === 'string' ? (JSON.parse(row.chunks) as SutraChunk[]) : row.chunks;
  // Persisted chunks may lack `id`; assign a 1-based sequential id so the
  // SutraChunkPicker can use it as a stable React key.
  // Also strip mojibake left by mysql2 when binding 4-byte UTF-8 chars (see
  // memory: mysql2-supp-plane-bug): orphan UTF-16 surrogate halves (length===2
  // BMP chars that aren't valid CJK) and U+FFFD replacement chars.
  const chunks: SutraChunk[] = rawChunks.map((c, i) => ({
    ...c,
    id: c.id ?? i + 1,
    content: c.content.map(s => sanitizeMojibake(s)),
  }));
  return {
    id: Number(row.id),
    title: row.title,
    slug: row.slug,
    chunks,
  };
}

function sanitizeMojibake(s: string): string {
  // Drop lone UTF-16 surrogate halves (mysql2 corrupts 4-byte UTF-8 to these)
  // and U+FFFD replacement chars that result. Length-1 BMP chars pass through.
  return Array.from(s)
    .filter(ch => {
      const code = ch.codePointAt(0)!;
      if (code >= 0xD800 && code <= 0xDFFF) return false; // surrogate half
      if (code === 0xFFFD) return false;                  // replacement char
      return true;
    })
    .join('');
}
