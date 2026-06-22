import { loadClassicFile, loadManifest } from './loader';
import type {
  ClassicCategory,
  ClassicChunk,
  ClassicDetail,
  ClassicFile,
  ClassicListItem,
  ClassicListResult,
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

export async function countByCategory(): Promise<Record<ClassicCategory, number>> {
  const manifest = await loadManifest();
  const map: Record<ClassicCategory, number> = {
    'four-books': 0,
    'five-classics': 0,
    mengxue: 0,
    philosophy: 0,
    history: 0,
    other: 0,
  };
  for (const b of manifest.books) {
    map[b.category] = (map[b.category] ?? 0) + 1;
  }
  return map;
}