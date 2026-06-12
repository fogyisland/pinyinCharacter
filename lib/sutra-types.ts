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
