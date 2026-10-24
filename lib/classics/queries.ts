import { loadClassicFile, loadManifest } from './loader';
import type {
  ClassicCategory,
  ClassicChapterPayload,
  ClassicChunk,
  ClassicChunkMeta,
  ClassicDetail,
  ClassicFile,
  ClassicListItem,
  ClassicListResult,
  ClassicMeta,
  ClassicOutline,
  ClassicsManifest,
} from '../classics-types';

const PAGE_SIZE = 12;

export interface ListClassicsArgs {
  category?: ClassicCategory;
  q?: string;
  page?: number;
  pageSize?: number;
}

function itemToListItem(item: ClassicsManifest['books'][number], id: number): ClassicListItem {
  return {
    id,
    slug: item.slug,
    title: item.title,
    category: item.category,
    author: item.author,
    era: item.era,
    chunkCount: item.chapterCount,
    charCount: item.charCount,
  };
}

function parseChunks(file: ClassicFile): ClassicChunk[] {
  return file.chunks.map((c, i) => ({
    id: c.id ?? i + 1,
    label: String(c.label ?? ''),
    content: c.content ?? [],
    pinyin: c.pinyin ?? [],
  }));
}

export async function listClassics(args: ListClassicsArgs = {}): Promise<ClassicListResult> {
  const manifest = await loadManifest();
  const page = Math.max(1, args.page ?? 1);
  const pageSize = Math.max(1, Math.min(50, args.pageSize ?? PAGE_SIZE));

  const q = args.q?.trim() ?? '';
  const filtered = manifest.books.filter((b) => {
    if (args.category && b.category !== args.category) return false;
    if (q && !b.title.includes(q)) return false;
    return true;
  });

  const offset = (page - 1) * pageSize;
  const slice = filtered.slice(offset, offset + pageSize);
  const items = slice.map((b, i) => itemToListItem(b, offset + i + 1));

  return { items, total: filtered.length, page, pageSize };
}

/**
 * The whole book — every chapter's text AND pinyin.
 *
 * A classic book runs to up to 8 MB of JSON, so this is a server-side
 * function only: never send its result to the browser. Use
 * `getClassicOutlineBySlug` for the chapter list and
 * `getClassicChapterPayload` for a single chapter.
 */
export async function getClassicBySlug(slug: string): Promise<ClassicDetail | null> {
  const file = await loadClassicFile(slug);
  if (!file) return null;
  const chunks = parseChunks(file);
  return {
    id: 0,
    slug: file.slug,
    title: file.title,
    category: file.category,
    author: file.author,
    era: file.era,
    chunks,
  };
}

/**
 * Book metadata straight from the manifest — no book file is read, so this
 * stays cheap even for the 8 MB books. Used for page metadata and headers.
 */
export async function getClassicMetaBySlug(slug: string): Promise<ClassicMeta | null> {
  const manifest = await loadManifest();
  const item = manifest.books.find((b) => b.slug === slug);
  if (!item) return null;
  return {
    slug: item.slug,
    title: item.title,
    category: item.category,
    author: item.author,
    era: item.era,
    chunkCount: item.chapterCount,
  };
}

/**
 * Chapter labels only. The chapter picker needs id + label; giving it the
 * full chapters (as the old code did) shipped the whole book to the browser.
 */
export async function getClassicChunkMetaBySlug(
  slug: string,
): Promise<ClassicChunkMeta[] | null> {
  const file = await loadClassicFile(slug);
  if (!file) return null;
  return file.chunks.map((c, i) => ({ id: c.id ?? i + 1, label: String(c.label ?? '') }));
}

/**
 * A book's outline — metadata plus the chapter list, without any text.
 *
 * A single classic book can be 8 MB of JSON, so the outline is what the
 * browser gets when it needs to know which chapters exist.
 */
export async function getClassicOutlineBySlug(slug: string): Promise<ClassicOutline | null> {
  const meta = await getClassicMetaBySlug(slug);
  if (!meta) return null;
  const chunks = await getClassicChunkMetaBySlug(slug);
  if (!chunks) return null;
  return { ...meta, chunkCount: chunks.length, chunks };
}

/** A single chapter (with text) — the only chapter a detail page needs. */
export async function getClassicChunkBySlug(
  slug: string,
  index: number,
): Promise<ClassicChunk | null> {
  const file = await loadClassicFile(slug);
  if (!file) return null;
  const chunks = parseChunks(file);
  return chunks[index] ?? null;
}

/**
 * A single chapter as the browser receives it: the text lines, the label and
 * the book's chapter count — but not the per-character pinyin, which is the
 * larger half of a chapter's JSON and is only used by the (server-rendered)
 * reading view.
 */
export async function getClassicChapterPayload(
  slug: string,
  index: number,
): Promise<ClassicChapterPayload | null> {
  const file = await loadClassicFile(slug);
  if (!file) return null;
  const chunks = parseChunks(file);
  const chunk = chunks[index];
  if (!chunk) return null;
  return {
    id: chunk.id,
    label: chunk.label,
    content: chunk.content,
    chunkCount: chunks.length,
  };
}

export async function countByCategory(): Promise<Record<ClassicCategory, number>> {
  const manifest = await loadManifest();
  const map: Record<ClassicCategory, number> = {
    'four-books': 0,
    'five-classics': 0,
    mengxue: 0,
    philosophy: 0,
    history: 0,
    other: 0,
    pianwen: 0,
  };
  for (const b of manifest.books) {
    map[b.category] = (map[b.category] ?? 0) + 1;
  }
  return map;
}
