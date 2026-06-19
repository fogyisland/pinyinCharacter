import { cellsPerPage } from './worksheet-page-count';

export type CellStyle = 'brush' | 'square' | 'pen' | 'cross';
export type PaperSize = 'A3' | 'A4' | 'B5';
export type FontFamily =
  | 'song' | 'kai' | 'hei'
  | 'wenkai-gb' | 'yozai' | 'iansui' | 'zen-kaku-thin'
  | 'ma-shan-zheng' | 'long-cang';

export interface Cell {
  char: string;
  style: CellStyle;
  index: number;
}

export interface Worksheet {
  id: number;
  userId: number;
  title: string;
  content: string[];
  cellStyle: CellStyle;
  paperSize: PaperSize;
  fontFamily: FontFamily;
  createdAt: Date;
}

export interface SaveWorksheetArgs {
  userId: number;
  title: string;
  content: string[];
  cellStyle: CellStyle;
  paperSize: PaperSize;
  fontFamily: FontFamily;
  ip?: string | null;
  userAgent?: string | null;
}

// Cells-per-page is a rough heuristic for the UI hint; the actual layout
// depends on the cell size in CSS and the printable area. Sourced from
// cellsPerPage() so the literal lives in one place (worksheet-page-count.ts).
export const PAPER_SIZES: { value: PaperSize; label: string; cols: number; cellsPerPage: number }[] = [
  { value: 'A3', label: 'A3 · 大', cols: 12, cellsPerPage: cellsPerPage('A3') },
  { value: 'A4', label: 'A4 · 标准', cols: 8,  cellsPerPage: cellsPerPage('A4') },
  { value: 'B5', label: 'B5 · 小', cols: 6,  cellsPerPage: cellsPerPage('B5') },
];

export const FONT_FAMILIES: {
  value: FontFamily;
  label: string;
  cssVar: string;
  group: 'system' | 'hard-pen' | 'brush';
}[] = [
  { value: 'song',          label: '宋体',                 cssVar: 'var(--font-han-serif)',         group: 'system' },
  { value: 'kai',           label: '楷体',                 cssVar: 'var(--font-wenkai)',            group: 'system' },
  { value: 'hei',           label: '黑体',                 cssVar: 'var(--font-han-sans)',          group: 'system' },
  { value: 'wenkai-gb',     label: '霞鹜文楷 GB',          cssVar: 'var(--font-lxgw-wenkai-gb)',    group: 'hard-pen' },
  { value: 'yozai',         label: '悠哉',                 cssVar: 'var(--font-yozai)',             group: 'hard-pen' },
  { value: 'iansui',        label: '芫荽',                 cssVar: 'var(--font-iansui)',            group: 'hard-pen' },
  { value: 'zen-kaku-thin', label: '思源极细黑',           cssVar: 'var(--font-zen-kaku-thin)',     group: 'hard-pen' },
  { value: 'ma-shan-zheng', label: '马善政体 (毛笔正书)',  cssVar: 'var(--font-ma-shan-zheng)',     group: 'brush' },
  { value: 'long-cang',     label: '龙藏体 (草书)',        cssVar: 'var(--font-long-cang)',         group: 'brush' },
];

export function paperSizeLabel(p: PaperSize): string {
  return PAPER_SIZES.find((s) => s.value === p)?.label ?? p;
}
export function fontFamilyLabel(f: FontFamily): string {
  return FONT_FAMILIES.find((x) => x.value === f)?.label ?? f;
}
export function fontFamilyCssVar(f: FontFamily): string {
  return FONT_FAMILIES.find((x) => x.value === f)?.cssVar ?? 'var(--font-han-serif)';
}
export function cellStyleLabel(s: CellStyle): string {
  switch (s) {
    case 'brush': return '毛笔格';
    case 'square': return '田字格';
    case 'pen': return '钢笔格';
    case 'cross': return '米字格';
  }
}

export type ValidationResult =
  | { ok: true; data: { title: string; content: string[]; cellStyle: CellStyle } }
  | { ok: false; error: string };

// 与 lib/validators.ts SINGLE_CJK 保持一致 (常用字 + 扩展A + 中文标点 + 全角)
const SINGLE_CJK = /^[㐀-鿿　-〿＀-￯]$/;

export function generateLayout(content: string[], style: CellStyle): Cell[] {
  return content.map((char, index) => ({ char, style, index }));
}

export function validateWorksheetInput(input: {
  title: unknown;
  content: unknown;
  cellStyle: unknown;
}): ValidationResult {
  if (typeof input.title !== 'string' || input.title.length < 1 || input.title.length > 80) {
    return { ok: false, error: 'title must be 1-80 chars' };
  }
  if (!Array.isArray(input.content) || input.content.length < 1 || input.content.length > 500) {
    return { ok: false, error: 'content must be 1-500 chars' };
  }
  if (!input.content.every((c) => typeof c === 'string' && SINGLE_CJK.test(c))) {
    return { ok: false, error: 'content must be CJK chars' };
  }
  if (
    input.cellStyle !== 'brush' &&
    input.cellStyle !== 'square' &&
    input.cellStyle !== 'pen' &&
    input.cellStyle !== 'cross'
  ) {
    return { ok: false, error: 'cellStyle must be brush, square, pen, or cross' };
  }
  return {
    ok: true,
    data: { title: input.title, content: input.content as string[], cellStyle: input.cellStyle },
  };
}

export { cellsPerPage } from './worksheet-page-count';
