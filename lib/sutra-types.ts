export interface SutraListItem {
  id: number;
  title: string;
  slug: string;
  chunkCount: number;
  charCount: number;
}

export interface SutraChunk {
  id: number;
  label: string;
  content: string[];
  pinyin: string[][];
}

/**
 * A chapter reduced to what the browser needs: the text and its label.
 *
 * The per-character pinyin array is ~84% of a chapter's JSON but nothing on
 * /sutra/[id] renders it — only the (server-side) print worksheet did. It
 * must not be serialized into the RSC payload of every chapter view.
 */
export interface SutraChunkText {
  id: number;
  label: string;
  content: string[];
}

export interface SutraDetail {
  id: number;
  title: string;
  slug: string;
  chunks: SutraChunk[];
}

export interface SutraListResult {
  items: SutraListItem[];
  total: number;
  page: number;
  pageSize: number;
}
