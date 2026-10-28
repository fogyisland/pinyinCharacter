import { getPool } from './db';
import type { RowDataPacket } from 'mysql2';
import type {
  SutraListItem,
  SutraListResult,
  SutraChunk,
  SutraChunkText,
  SutraDetail,
} from './sutra-types';
import { listSutrasFromFs, getSutraByIdFromFs } from './sutras-fs';

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

/** A `sutras` row as mysql2 returns it (`chunks` is a JSON column). */
interface RawSutraRow extends RowDataPacket {
  id: number;
  title: string;
  slug: string;
  chunks: string | SutraChunk[];
  source: string | null;
}

/** A `COUNT(*)` row of the sutras table. */
interface SutraTotalRow extends RowDataPacket {
  total: number;
}

function mapListRow(r: RawSutraRow): SutraListItem {
  const chunks = typeof r.chunks === 'string' ? (JSON.parse(r.chunks) as SutraChunk[]) : r.chunks;
  const charCount = chunks.reduce(
    (sum, c) => sum + c.content.reduce((s, line) => s + Array.from(line).length, 0),
    0,
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
  const fs = listSutrasFromFs(args);
  if (fs) return fs;
  const pool = getPool();
  const page = Math.max(1, args.page ?? 1);
  const pageSize = Math.max(1, Math.min(PAGE_SIZE, args.pageSize ?? PAGE_SIZE));
  const offset = (page - 1) * pageSize;
  const { where, params } = buildSearchWhere(args.q ?? '');

  const sql = `SELECT id, title, slug, chunks FROM sutras
               ${where}
               ORDER BY id ASC
               LIMIT ? OFFSET ?`;
  const [rows] = await pool.query<RawSutraRow[]>(sql, [...params, pageSize, offset]);
  const [[{ total }]] = await pool.query<SutraTotalRow[]>(
    `SELECT COUNT(*) AS total FROM sutras ${where}`,
    params,
  );

  return {
    items: rows.map(mapListRow),
    total: Number(total),
    page,
    pageSize,
  };
}

/**
 * A sutra chunk reduced to what the chapter picker needs (id + label).
 */
export interface SutraChunkMeta {
  id: number;
  label: string;
}

export interface SutraMeta {
  id: number;
  title: string;
  slug: string;
  chunkCount: number;
  chunks: SutraChunkMeta[];
}

interface SutraSource {
  id: number;
  title: string;
  slug: string;
  chunks: SutraChunk[];
}

/**
 * Load a sutra's chapters from the filesystem (primary) or the DB (fallback).
 * Chunk ids are forced to 0-based to match the `?chunk=N` URL convention used
 * by app/sutra/[id] and the copy-progress API. Persisted 1-based ids
 * (e.g. xinjing.json's `id: 1` for its only chunk) are ignored — they were a
 * stale convention that mismatched the rest of the sutra stack and caused
 * 400s on the first chunk of any single-chunk sutra.
 */
async function loadSutraSource(id: number): Promise<SutraSource | null> {
  const fs = getSutraByIdFromFs(id);
  if (fs) {
    return {
      id: fs.id,
      title: fs.title,
      slug: fs.slug,
      chunks: normalizeChunks(fs.chunks),
    };
  }
  const pool = getPool();
  const [rows] = await pool.query<RawSutraRow[]>(
    `SELECT id, title, slug, chunks FROM sutras WHERE id = ? LIMIT 1`,
    [id],
  );
  const row = rows[0];
  if (!row) return null;
  const rawChunks =
    typeof row.chunks === 'string' ? (JSON.parse(row.chunks) as SutraChunk[]) : row.chunks;
  return {
    id: Number(row.id),
    title: row.title,
    slug: row.slug,
    chunks: normalizeChunks(rawChunks),
  };
}

function normalizeChunks(raw: SutraChunk[]): SutraChunk[] {
  return raw.map((c, i) => ({
    ...c,
    id: i,
    content: c.content.map((s) => sanitizeMojibake(s)),
  }));
}

export async function getSutra(id: number): Promise<SutraDetail | null> {
  const src = await loadSutraSource(id);
  if (!src) return null;
  return { id: src.id, title: src.title, slug: src.slug, chunks: src.chunks };
}

/**
 * Chapter metadata only — no chapter text. Used by pages that render a
 * single chapter and must not ship the whole book to the browser.
 */
export async function getSutraMeta(id: number): Promise<SutraMeta | null> {
  const src = await loadSutraSource(id);
  if (!src) return null;
  return {
    id: src.id,
    title: src.title,
    slug: src.slug,
    chunkCount: src.chunks.length,
    chunks: src.chunks.map((c) => ({ id: c.id, label: c.label })),
  };
}

/** A single chapter (with text) — the only chapter a detail page needs. */
export async function getSutraChunk(id: number, chunkIndex: number): Promise<SutraChunk | null> {
  const src = await loadSutraSource(id);
  if (!src) return null;
  return src.chunks[chunkIndex] ?? null;
}

/**
 * Drop the per-character pinyin array from a chapter.
 *
 * The pinyin array is 84% of a chapter's JSON (930 KB vs 173 KB of actual
 * text across all 11 sutras) and nothing on /sutra/[id] renders it — the
 * per-character pinyin only ever appeared in the server-side print
 * worksheet. Left in place it was serialized into the RSC payload of every
 * chapter view, so a reader paid for it on every page load.
 */
export function toChunkText(chunk: SutraChunk): SutraChunkText {
  return { id: chunk.id, label: chunk.label, content: chunk.content };
}

/** A single chapter's plain text, joined for TTS synthesis. */
export async function getSutraChunkText(id: number, chunkIndex: number): Promise<string | null> {
  const chunk = await getSutraChunk(id, chunkIndex);
  if (!chunk) return null;
  return chunk.content.join('\n');
}

/**
 * Matches any lone UTF-16 surrogate half or U+FFFD replacement char — the
 * corruption mysql2 leaves behind when binding 4-byte UTF-8 (see memory:
 * mysql2-supp-plane-bug). Used as a cheap pre-test so the common case (plain
 * BMP text) skips the per-code-point rewrite entirely.
 */
const MOJIBAKE_RE = /[\uD800-\uDFFF\uFFFD]/;

function sanitizeMojibake(s: string): string {
  // Fast path: nothing to strip.
  if (!MOJIBAKE_RE.test(s)) return s;
  // Drop lone UTF-16 surrogate halves (mysql2 corrupts 4-byte UTF-8 to these)
  // and U+FFFD replacement chars that result. Length-1 BMP chars pass through.
  return Array.from(s)
    .filter((ch) => {
      const code = ch.codePointAt(0)!;
      if (code >= 0xd800 && code <= 0xdfff) return false; // surrogate half
      if (code === 0xfffd) return false; // replacement char
      return true;
    })
    .join('');
}
