export type ClassicCategory =
  'four-books' | 'five-classics' | 'mengxue' | 'philosophy' | 'history' | 'other' | 'pianwen';

export interface ClassicChunk {
  id: number; // 1-based, contiguous within book
  label: string; // e.g. "学而第一", "第一篇", "乾"
  content: string[]; // lines of text including punctuation
  pinyin: string[][]; // line-aligned pinyin; punctuation chars → "" entry
}

/**
 * A chapter reduced to what the chapter picker needs. Detail pages render a
 * single chapter, so the picker must not receive the book's text.
 */
export interface ClassicChunkMeta {
  id: number;
  label: string;
}

/** Book metadata without any chapter text. */
export interface ClassicMeta {
  slug: string;
  title: string;
  category: ClassicCategory;
  author: string | null;
  era: string | null;
  chunkCount: number;
}

export interface ClassicListItem {
  id: number;
  slug: string;
  title: string;
  category: ClassicCategory;
  author: string | null;
  era: string | null;
  chunkCount: number;
  charCount: number;
}

export interface ClassicDetail {
  id: number;
  slug: string;
  title: string;
  category: ClassicCategory;
  author: string | null;
  era: string | null;
  chunks: ClassicChunk[];
}

export interface ClassicListResult {
  items: ClassicListItem[];
  total: number;
  page: number;
  pageSize: number;
}

// Manifest entry as written to data/classics-manifest.json
export interface ClassicManifestItem {
  slug: string;
  title: string;
  source: string;
  category: ClassicCategory;
  author: string | null;
  era: string | null;
  chapterCount: number;
  charCount: number;
  jsonFile: string;
  jsonBytes: number;
  bookId?: string;
  bookTitle?: string;
}

export interface ClassicsManifest {
  version: 1;
  updatedAt: string;
  books: ClassicManifestItem[];
}

// Per-book file structure (data/classics/<slug>.json)
export interface ClassicFile {
  slug: string;
  title: string;
  category: ClassicCategory;
  author: string | null;
  era: string | null;
  source: string;
  bookId: string;
  bookTitle: string;
  chapterRange: { from: number; to: number };
  chunks: ClassicChunk[];
}
