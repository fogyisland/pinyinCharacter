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
