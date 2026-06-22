export type Dynasty = string;

export interface PoemListItem {
  id: number;
  title: string;
  author: string;
  dynasty: Dynasty;
  form: string | null;
}

export interface PoemDetail extends PoemListItem {
  content: string[];
  pinyin: string[][];
  appreciation: string | null;
}

export interface PoemListResult {
  items: PoemListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export type PoemFont = 'kai' | 'xiao-kai' | 'li-shu' | 'zhuan-shu' | 'mao-bi';

export const POEM_FONT_CSS: Record<PoemFont, string> = {
  kai: 'var(--font-kai)',
  'xiao-kai': 'var(--font-iansui)',
  'li-shu': 'var(--font-lishu)',
  'zhuan-shu': 'var(--font-xiaozhuan)',
  'mao-bi': 'var(--font-ma-shan-zheng)',
};

export const POEM_FONT_LABEL: Record<PoemFont, string> = {
  kai: '楷书',
  'xiao-kai': '小楷',
  'li-shu': '隶书',
  'zhuan-shu': '篆书',
  'mao-bi': '毛笔',
};

export const POEM_FONT_STORAGE_KEY = 'pinyin:poem-font';
export const DEFAULT_POEM_FONT: PoemFont = 'kai';

export interface PoemManifestItem {
  id: number;
  title: string;
  author: string;
  dynasty: string;
  category: string | null;
  form: string | null;
  contentLineCount: number;
}

export interface PoemsManifest {
  version: 1;
  updatedAt: string;
  count: number;
  items: PoemManifestItem[];
}
