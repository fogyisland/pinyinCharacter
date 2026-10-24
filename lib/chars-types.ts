/**
 * A raw row of the `chars` table, before hydration into `Char`.
 *
 * Shared by lib/chars.ts (which hydrates rows) and lib/pinyin-index.ts
 * (which indexes them) so both sides agree on the column names.
 */
export interface CharRow {
  char: string;
  level: 1 | 2 | 3;
  pinyin: string;
  radical: string;
  stroke_count: number;
  unicode_codepoint: string;
  /** 2026-07-04: HSK 1-6 level. NULL until the HSK import covers the char. */
  hsk_level?: number | null;
}

export interface Char {
  char: string;
  level: 1 | 2 | 3;
  pinyin: string;
  pinyinAlt: string[];
  radical: string;
  strokeCount: number;
  meaningZh: string | null;
  meaningEn: string | null;
  unicodeCodepoint: string;
  variants: string[];
  /**
   * 2026-07-04: HSK 1-6 level for /game progressive reveal. NULL until the
   * HSK import covers this char (see migration 2026-07-04-hsk-level.sql).
   * Optional because it's populated only after the HSK migration runs and
   * the import script has filled it in. Older fixtures/tests may omit it.
   */
  hskLevel?: number | null;
}

export interface CharWithRelated extends Char {
  relatedByRadical: Char[];
  relatedByPinyin: Char[];
}

export interface CharListResult {
  chars: Char[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CharClient extends Omit<Char, never> {
  pinyinAlt: string[]; // already serializable
  variants: string[]; // already serializable
}

export interface CharDetailClient extends Omit<CharWithRelated, never> {}

export interface CharListClient {
  chars: CharClient[];
  total: number;
  page: number;
  pageSize: number;
}
