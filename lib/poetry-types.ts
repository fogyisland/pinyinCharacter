export type Dynasty = 'tang' | 'song';

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
