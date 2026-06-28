import { cellsPerPage } from './worksheet-page-count';

export type Tool = 'brush' | 'pen';
export type Presentation = 'square' | 'cross';
export type CellStyle =
  | 'brush-square' | 'brush-cross'
  | 'pen-square'   | 'pen-cross'
  | 'brush-trace-square' | 'brush-trace-cross';
export type PaperSize = 'A3' | 'A4' | 'B5' | 'brush-12' | 'brush-24' | 'brush-28';
export type FontFamily =
  | 'song' | 'kai' | 'hei'
  | 'wenkai-gb' | 'yozai' | 'iansui' | 'zen-kaku-thin'
  | 'ma-shan-zheng' | 'long-cang'
  | 'liu-jian-mao-cao' | 'zcool-xiaowei' | 'zhi-mang-xing';

const ALL_TOOLS: readonly Tool[] = ['brush', 'pen'];
const ALL_PRESENTATIONS: readonly Presentation[] = ['square', 'cross'];
const ALL_CELL_STYLES: readonly CellStyle[] = [
  'brush-square', 'brush-cross', 'pen-square', 'pen-cross',
  'brush-trace-square', 'brush-trace-cross',
] as const;

// Compose / split helpers
export function composeCellStyle(tool: Tool, presentation: Presentation, trace: boolean = false): CellStyle {
  if (tool === 'brush' && trace) {
    return `brush-trace-${presentation}` as CellStyle;
  }
  return `${tool}-${presentation}` as CellStyle;
}

export function getTool(s: CellStyle): Tool {
  return s.split('-')[0] as Tool;
}

export function getPresentation(s: CellStyle): Presentation {
  if (s.includes('cross')) return 'cross';
  return 'square';
}

export function getIsTrace(s: CellStyle): boolean {
  return s.includes('-trace-');
}

// Defaults
export function defaultToolFor(): Tool {
  return 'brush';  // matches G3 default
}

export function defaultPresentationFor(): Presentation {
  return 'square';
}

export function defaultFontFor(tool: Tool): FontFamily {
  return tool === 'brush' ? 'ma-shan-zheng' : 'wenkai-gb';
}

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
  { value: 'A3',       label: 'A3 · 大',       cols: 12, cellsPerPage: cellsPerPage('A3') },
  { value: 'A4',       label: 'A4 · 标准',     cols: 8,  cellsPerPage: cellsPerPage('A4') },
  { value: 'B5',       label: 'B5 · 小',       cols: 6,  cellsPerPage: cellsPerPage('B5') },
  { value: 'brush-12', label: '12 字 · 毛笔',  cols: 4,  cellsPerPage: 12 },
  { value: 'brush-24', label: '24 字 · 毛笔',  cols: 6,  cellsPerPage: 24 },
  { value: 'brush-28', label: '28 字 · 毛笔',  cols: 7,  cellsPerPage: 28 },
];

// PracticeTemplate per-paper cell size. Cols come from CSS
// (app/globals.css worksheet-grid--*), rows = cellsPerPage / cols.
// cellSize varies per paper so the grid fills the printable area without
// overflowing horizontally (12 × 80px overflows A3 inner width).
export const PRACTICE_LAYOUT: Record<PaperSize, { cellSize: number }> = {
  A3:         { cellSize: 70  },
  A4:         { cellSize: 80  },
  B5:         { cellSize: 80  },
  'brush-12': { cellSize: 140 },
  'brush-24': { cellSize: 100 },
  'brush-28': { cellSize: 85  },
};

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
  { value: 'zen-kaku-thin', label: '思源极细黑',           cssVar: 'var(--font-zen-kaku-thin)',     group: 'hard-pen' },
  { value: 'iansui',        label: '芫荽 (行书毛笔)',      cssVar: 'var(--font-iansui)',            group: 'brush' },
  { value: 'ma-shan-zheng', label: '马善政体 (毛笔正书)',  cssVar: 'var(--font-ma-shan-zheng)',     group: 'brush' },
  { value: 'long-cang',     label: '龙藏体 (草书)',        cssVar: 'var(--font-long-cang)',         group: 'brush' },
  { value: 'liu-jian-mao-cao', label: '柳健毛草 (狂草)',    cssVar: 'var(--font-liu-jian-mao-cao)',  group: 'brush' },
  { value: 'zcool-xiaowei', label: '站酷小薇 (毛笔楷书)',  cssVar: 'var(--font-zcool-xiaowei)',     group: 'brush' },
  { value: 'zhi-mang-xing', label: '志莽星 (行草)',        cssVar: 'var(--font-zhi-mang-xing)',     group: 'brush' },
];

export const BRUSH_PAPER_SIZES = ['brush-12', 'brush-24', 'brush-28'] as const;
export type BrushPaperSize = typeof BRUSH_PAPER_SIZES[number];

export function isBrushSize(p: PaperSize): p is BrushPaperSize {
  return (BRUSH_PAPER_SIZES as readonly string[]).includes(p);
}

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
  const tool = getTool(s) === 'brush' ? '毛笔' : '钢笔';
  const pres = getPresentation(s) === 'square' ? '田字格' : '米字格';
  return getIsTrace(s) ? `${tool}·${pres}·描红` : `${tool}·${pres}`;
}

export type ValidationResult =
  | { ok: true; data: { title: string; content: string[]; cellStyle: CellStyle; paperSize: PaperSize } }
  | { ok: false; error: string };

// 与 lib/validators.ts SINGLE_CJK 保持一致 (常用字 + 扩展A + 中文标点 + 全角)
const SINGLE_CJK = /^[㐀-鿿　-〿＀-￯]$/;

const VALID_PAPER_SIZES = ['A3', 'A4', 'B5', 'brush-12', 'brush-24', 'brush-28'] as const;

export function generateLayout(content: string[], style: CellStyle): Cell[] {
  return content.map((char, index) => ({ char, style, index }));
}

export function validateWorksheetInput(input: {
  title: unknown;
  content: unknown;
  cellStyle: unknown;
  paperSize?: unknown;
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
  if (!(ALL_CELL_STYLES as readonly string[]).includes(input.cellStyle as string)) {
    return { ok: false, error: 'cellStyle must be one of: brush-square, brush-cross, pen-square, pen-cross, brush-trace-square, brush-trace-cross' };
  }
  const cellStyle = input.cellStyle as CellStyle;
  // paperSize is optional in input but defaults to 'A4' for non-brush; brush defaults to 'brush-12'
  let paperSize: PaperSize;
  if (input.paperSize === undefined) {
    paperSize = getTool(cellStyle) === 'brush' ? 'brush-12' : 'A4';
  } else if (
    typeof input.paperSize === 'string' &&
    (VALID_PAPER_SIZES as readonly string[]).includes(input.paperSize)
  ) {
    paperSize = input.paperSize as PaperSize;
  } else {
    return { ok: false, error: 'paperSize must be A3, A4, B5, brush-12, brush-24, or brush-28' };
  }
  return {
    ok: true,
    data: { title: input.title, content: input.content as string[], cellStyle, paperSize },
  };
}

export { cellsPerPage } from './worksheet-page-count';
