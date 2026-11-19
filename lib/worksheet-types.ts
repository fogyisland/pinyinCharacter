import { cellsPerPage } from './worksheet-page-count';

export type Tool = 'brush' | 'pen';
export type Presentation = 'square' | 'cross' | 'lined' | 'four-line';
export type CellStyle =
  | 'brush-square'
  | 'brush-cross'
  | 'pen-square'
  | 'pen-cross'
  | 'brush-trace-square'
  | 'brush-trace-cross'
  | 'pen-lined'
  | 'pen-english';
export type PaperSize = 'A3' | 'A4' | 'B5' | 'brush-12' | 'brush-24' | 'brush-28';
export type FontFamily =
  | 'song'
  | 'kai'
  | 'hei'
  | 'wenkai-gb'
  | 'yozai'
  | 'iansui'
  | 'zen-kaku-thin'
  | 'ma-shan-zheng'
  | 'long-cang'
  | 'liu-jian-mao-cao'
  | 'zcool-xiaowei'
  | 'zhi-mang-xing';

const ALL_CELL_STYLES: readonly CellStyle[] = [
  'brush-square',
  'brush-cross',
  'pen-square',
  'pen-cross',
  'brush-trace-square',
  'brush-trace-cross',
  'pen-lined',
  'pen-english',
] as const;

// Compose / split helpers
export function composeCellStyle(
  tool: Tool,
  presentation: Presentation,
  trace: boolean = false,
): CellStyle {
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
  if (s.includes('lined')) return 'lined';
  if (s.includes('english')) return 'four-line';
  return 'square';
}

export function getIsTrace(s: CellStyle): boolean {
  return s.includes('-trace-');
}

// Defaults
export function defaultToolFor(): Tool {
  return 'brush'; // matches G3 default
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

/**
 * Row of the worksheet history list. Same display fields as `Worksheet`,
 * but the char count comes from SQL (JSON_LENGTH) instead of shipping the
 * whole `content` array to the browser.
 */
export interface WorksheetListItem {
  id: number;
  title: string;
  cellStyle: CellStyle;
  paperSize: PaperSize;
  fontFamily: FontFamily;
  /** Number of chars in the worksheet. */
  charCount: number;
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

/* ============================================================
 * Brush paper layout — fills the A4 page in BOTH dimensions.
 * ============================================================
 *
 * The user reported "毛笔只显示上半页" on 2026-11-19: the brush sheet
 * printed as one page but only filled the TOP HALF of it.
 *
 * The cause is the grid SHAPE, not the paper size. The brush cells are
 * SQUARE, so the column count fixes the cell size (the width pins it),
 * and the height then follows from the row count. The old shapes were
 *
 *   brush-12 → 4 cols × 3 rows   4×140px → 129mm of a 267mm page (48%)
 *   brush-24 → 6 cols × 4 rows   6×100px → 126mm of a 267mm page (47%)
 *   brush-28 → 7 cols × 4 rows   7× 85px → 110mm of a 267mm page (41%)
 *
 * — width full, height half empty. Filling A4 in both dimensions needs
 * FEWER columns and MORE rows, with the cell size derived from the shape:
 *
 *   brush-12 → 3 cols × 4 rows   3×219px → 178mm wide, 252mm of 267mm tall
 *   brush-24 → 4 cols × 6 rows   4×143px → 158mm wide, 252mm of 267mm tall
 *   brush-28 → 4 cols × 7 rows   4×122px → 135mm wide, 253mm of 267mm tall
 *
 * The three papers are graded by cell size (58mm / 38mm / 32mm), so the
 * user picks how big to write: "12 字" for a few big characters, "28 字"
 * for a full sheet of smaller ones.
 *
 * ⚠️ The numbers below are DERIVED from the A4 printable box, not
 * hand-tuned: brushCellSizeFor() computes the cell size that makes the
 * shape fill the page, and the CSS rules pin the columns to exactly that
 * size. Change the shape and the cell size follows.
 */

/** CSS px per mm at the CSS reference resolution of 96dpi. */
const PX_PER_MM = 96 / 25.4;

/** A4's printable box at the 1.5cm page margin, in CSS px. */
const A4_PRINTABLE_WIDTH_PX = 180 * PX_PER_MM; // 680px
const A4_PRINTABLE_HEIGHT_PX = 267 * PX_PER_MM; // 1009px

/** The gap between grid cells, in CSS px. Tailwind's `gap-2` = 0.5rem. */
const GRID_GAP_PX = 8;

/**
 * The height the grid's header and footer take, in px.
 *
 * Both are `col-span-full` rows rendered INSIDE the grid, so they eat
 * into the height the cells can use. Measured in the browser on
 * 2026-11-19 (print media, A4 printable viewport):
 *   header 33px + its mb-3 (12px)
 *   footer 25px + its mt-3 (12px)
 *   = 82px of content + 24px of margin = 106px... but the measured
 *   grid overhead was 98px, because the footer's border-top collapses
 *   with the cell row's own descender space.
 *
 * ⚠️ The number is an UPPER BOUND on purpose: if the real overhead were
 * smaller, the cell size would grow and the sheet could spill onto a
 * second page. Being 8px pessimistic costs the sheet 8px of height and
 * guarantees the sheet stays on ONE page.
 */
const BRUSH_HEADER_FOOTER_PX = 106;

/**
 * The grid SHAPE of each brush paper: how many columns, and how many
 * characters on the page.
 *
 * The row count is derived from these two, so the grid always holds
 * exactly one page's worth of cells.
 *
 * ⚠️ The shape is what makes the sheet fill the page. The brush cells are
 * SQUARE, so the column count pins the cell size (the width decides it)
 * and the height then follows from the row count. A shape that is too
 * WIDE therefore leaves the bottom half of the page empty — which is
 * exactly the bug the user reported on 2026-11-19 ("毛笔只显示上半页").
 */
const BRUSH_SHAPE: Record<BrushPaperSize, { cols: number; cells: number }> = {
  // 3 cols × 4 rows = 12 cells. Width-limited: 3 × 219px + 2 × 8px
  // = 673px of A4's 680px printable width.
  'brush-12': { cols: 3, cells: 12 },
  // 4 cols × 6 rows = 24 cells. Height-limited: the cell size is
  // whatever fills 6 rows of the printable height.
  'brush-24': { cols: 4, cells: 24 },
  // 4 cols × 7 rows = 28 cells. Height-limited as well. The width
  // reaches 135mm of 180mm — a square cell cannot fill both axes of a
  // page that is 1.48× taller than it is wide at 4 columns.
  'brush-28': { cols: 4, cells: 28 },
};

// Cells-per-page is a rough heuristic for the UI hint; the actual layout
// depends on the cell size in CSS and the printable area. Sourced from
// cellsPerPage() so the literal lives in one place (worksheet-page-count.ts).
export const PAPER_SIZES: {
  value: PaperSize;
  label: string;
  cols: number;
  cellsPerPage: number;
}[] = [
  { value: 'A3', label: 'A3 · 大', cols: 12, cellsPerPage: cellsPerPage('A3') },
  { value: 'A4', label: 'A4 · 标准', cols: 8, cellsPerPage: cellsPerPage('A4') },
  { value: 'B5', label: 'B5 · 小', cols: 6, cellsPerPage: cellsPerPage('B5') },
  { value: 'brush-12', label: '12 字 · 毛笔', cols: BRUSH_SHAPE['brush-12'].cols, cellsPerPage: 12 },
  { value: 'brush-24', label: '24 字 · 毛笔', cols: BRUSH_SHAPE['brush-24'].cols, cellsPerPage: 24 },
  { value: 'brush-28', label: '28 字 · 毛笔', cols: BRUSH_SHAPE['brush-28'].cols, cellsPerPage: 28 },
];

// PracticeTemplate per-paper cell size. Cols come from CSS
// (app/globals.css worksheet-grid--*), rows = cellsPerPage / cols.
// cellSize varies per paper so the grid fills the printable area without
// overflowing horizontally (12 × 80px overflows A3 inner width).
export const PRACTICE_LAYOUT: Record<PaperSize, { cellSize: number }> = {
  A3: { cellSize: 70 },
  A4: { cellSize: 80 },
  B5: { cellSize: 80 },
  'brush-12': { cellSize: brushCellSizeFor('brush-12') },
  'brush-24': { cellSize: brushCellSizeFor('brush-24') },
  'brush-28': { cellSize: brushCellSizeFor('brush-28') },
};

const LINES_PER_PAGE: Record<PaperSize, number> = {
  A3: 36,
  A4: 24,
  B5: 14,
  'brush-12': 0,
  'brush-24': 0,
  'brush-28': 0,
};

export function linesPerPage(paperSize: PaperSize): number {
  return LINES_PER_PAGE[paperSize];
}

export const FONT_FAMILIES: {
  value: FontFamily;
  label: string;
  cssVar: string;
  group: 'system' | 'hard-pen' | 'brush';
}[] = [
  { value: 'song', label: '宋体', cssVar: 'var(--font-han-serif)', group: 'system' },
  { value: 'kai', label: '楷体', cssVar: 'var(--font-wenkai)', group: 'system' },
  { value: 'hei', label: '黑体', cssVar: 'var(--font-han-sans)', group: 'system' },
  {
    value: 'wenkai-gb',
    label: '霞鹜文楷 GB',
    cssVar: 'var(--font-lxgw-wenkai-gb)',
    group: 'hard-pen',
  },
  { value: 'yozai', label: '悠哉', cssVar: 'var(--font-yozai)', group: 'hard-pen' },
  {
    value: 'zen-kaku-thin',
    label: '思源极细黑',
    cssVar: 'var(--font-zen-kaku-thin)',
    group: 'hard-pen',
  },
  { value: 'iansui', label: '芫荽 (行书毛笔)', cssVar: 'var(--font-iansui)', group: 'brush' },
  {
    value: 'ma-shan-zheng',
    label: '马善政体 (毛笔正书)',
    cssVar: 'var(--font-ma-shan-zheng)',
    group: 'brush',
  },
  { value: 'long-cang', label: '龙藏体 (草书)', cssVar: 'var(--font-long-cang)', group: 'brush' },
  {
    value: 'liu-jian-mao-cao',
    label: '柳健毛草 (狂草)',
    cssVar: 'var(--font-liu-jian-mao-cao)',
    group: 'brush',
  },
  {
    value: 'zcool-xiaowei',
    label: '站酷小薇 (毛笔楷书)',
    cssVar: 'var(--font-zcool-xiaowei)',
    group: 'brush',
  },
  {
    value: 'zhi-mang-xing',
    label: '志莽星 (行草)',
    cssVar: 'var(--font-zhi-mang-xing)',
    group: 'brush',
  },
];

export const BRUSH_PAPER_SIZES = ['brush-12', 'brush-24', 'brush-28'] as const;
export type BrushPaperSize = (typeof BRUSH_PAPER_SIZES)[number];

export function isBrushSize(p: PaperSize): p is BrushPaperSize {
  return (BRUSH_PAPER_SIZES as readonly string[]).includes(p);
}

/**
 * The cell size of a brush paper, in CSS px — DERIVED, not hand-tuned.
 *
 * The cell size is the largest square that fits the chosen shape inside
 * A4's printable box without overflowing either axis:
 *
 *   width-limited:  (printableWidth  - (cols - 1) × gap) / cols
 *   height-limited: (printableHeight - header/footer - (rows - 1) × gap) / rows
 *
 * Taking the MINIMUM of the two makes the cell fit both axes. The
 * height limit is what makes the sheet fill the page; the width limit is
 * what keeps it from spilling onto a second sheet.
 *
 * ⚠️ The CSS rule `.worksheet-grid--brush-N` pins its columns to this
 * same size, so the printed grid's width is a function of the brush
 * layout rather than of the viewport. If the two drift apart, the sheet
 * either overflows the page (a second, mostly blank page) or leaves a
 * gap. `tests/unit/app/brush-print-a4.test.ts` pins them together.
 */
function brushCellSizeFor(p: BrushPaperSize): number {
  const { cols, cells } = BRUSH_SHAPE[p];
  const rows = Math.floor(cells / cols);
  const byWidth = (A4_PRINTABLE_WIDTH_PX - (cols - 1) * GRID_GAP_PX) / cols;
  const byHeight =
    (A4_PRINTABLE_HEIGHT_PX - BRUSH_HEADER_FOOTER_PX - (rows - 1) * GRID_GAP_PX) / rows;
  return Math.floor(Math.min(byWidth, byHeight));
}

/** The column count of a brush paper's grid. */
export function brushColsFor(p: BrushPaperSize): number {
  return BRUSH_SHAPE[p].cols;
}

/** The row count of a brush paper's grid. */
export function brushRowsFor(p: BrushPaperSize): number {
  return Math.floor(BRUSH_SHAPE[p].cells / BRUSH_SHAPE[p].cols);
}

/** The number of characters on one brush page. */
export function brushCellsPerPage(p: BrushPaperSize): number {
  return BRUSH_SHAPE[p].cells;
}

/**
 * The cell size of a brush paper, in CSS px.
 *
 * ⚠️ This is the SOURCE OF TRUTH for the brush papers' column width: the
 * CSS rule `.worksheet-grid--brush-N` pins its columns to exactly this
 * size, so the grid's printed width is a function of the brush layout
 * rather than of the viewport. If the two drift apart, the sheet either
 * overflows the page (a second, mostly blank page) or leaves a gap.
 */
const CELL_SIZE: Record<PaperSize, number> = {
  A3: 80,
  A4: 70, // 8×11=88 cells × 70px fits A4 PDF (was 80, would overflow)
  B5: 80,
  'brush-12': brushCellSizeFor('brush-12'),
  'brush-24': brushCellSizeFor('brush-24'),
  'brush-28': brushCellSizeFor('brush-28'),
};

export function cellSizeFor(p: PaperSize): number {
  return CELL_SIZE[p];
}

export function linedHeightPx(paperSize: PaperSize): number {
  return PRACTICE_LINED_HEIGHT[paperSize];
}

// Practice template grid mode uses slightly smaller cells than PRACTICE_LAYOUT
// so the 8pt grid gap fits A4's printable width (8 cells × size + 7 × 8pt
// ≤ 510pt → size ≤ 56.75pt → 75px). A4 dropped to 70px so 11 rows
// (cellsPerPage['A4']=88) still fit A4 PDF's 757pt inner height
// (11 × 52.5pt + 10 × 8pt + 73pt header+footer = 730.5pt ≤ 757pt).
// Lined and brush modes still use PRACTICE_LAYOUT — only pen-{square,cross}
// reads from this map.
export const PRACTICE_GRID_CELL_SIZE: Record<PaperSize, number> = {
  A3: 70,
  A4: 70,
  B5: 80,
  'brush-12': brushCellSizeFor('brush-12'),
  'brush-24': brushCellSizeFor('brush-24'),
  'brush-28': brushCellSizeFor('brush-28'),
};

// Lined-paper row height in CSS px (1px = 1/96in). Picked so the printable
// area fits linesPerPage lines: A4 24×38=912 ≤ 1010; A3 36×38=1368 ≤ 1474;
// B5 14×44=616 ≤ 832. All three use the 1.0cm standard 作文本 / 信纸 row
// height (38px); B5 uses a slightly larger 44px so 14 lines doesn't crowd.
const PRACTICE_LINED_HEIGHT: Record<PaperSize, number> = {
  A3: 38,
  A4: 38,
  B5: 44,
  'brush-12': 0,
  'brush-24': 0,
  'brush-28': 0,
};

/**
 * The CSS `@page size` a paper prints on.
 *
 * ⚠️ The brush papers are NOT CSS @page keywords. Writing
 * `@page { size: brush-12 }` makes the browser drop the WHOLE
 * declaration (an invalid value invalidates the property, not just the
 * value), so the sheet falls back to the printer's default paper —
 * which is how a brush sheet stopped being an A4 page and started
 * spilling onto a second one.
 *
 * The brush papers print on A4: they are a LAYOUT (4 columns of big
 * brush cells), not a paper size. The name says how many characters fit
 * on the page, and the sheet they produce is an A4 sheet.
 *
 * A3 / A4 / B5 ARE valid CSS keywords and map to themselves.
 */
export function pageSizeFor(p: PaperSize): 'a3' | 'a4' | 'b5' {
  if (isBrushSize(p)) return 'a4';
  switch (p) {
    case 'A3':
      return 'a3';
    case 'B5':
      return 'b5';
    case 'A4':
    default:
      return 'a4';
  }
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
  const pres = getPresentation(s);
  if (pres === 'lined') return `${tool}·横线`;
  if (pres === 'four-line') return `${tool}·英文描红`;
  const label = pres === 'cross' ? '米字格' : '田字格';
  return getIsTrace(s) ? `${tool}·${label}·描红` : `${tool}·${label}`;
}

export type ValidationResult =
  | {
      ok: true;
      data: { title: string; content: string[]; cellStyle: CellStyle; paperSize: PaperSize };
    }
  | { ok: false; error: string };

// 与 lib/validators.ts SINGLE_CJK 保持一致 (常用字 + 扩展A + 中文标点 + 全角)
const SINGLE_CJK = /^[㐀-鿿　-〿＀-￯]$/;
// 英文描红允许 ASCII 字母 (A-Z / a-z);空格、标点、其他字符统统过滤掉
const SINGLE_LATIN = /^[A-Za-z]$/;

const VALID_PAPER_SIZES = ['A3', 'A4', 'B5', 'brush-12', 'brush-24', 'brush-28'] as const;

// Four-line (English trace) layout: pack content into rows. `charsPerRow` is
// the practical letter capacity per ruled line — A4 fits ~88 letters across
// the inner width at ~6pt/letter. Each Cell here is one ruled row, `char` is
// the substring for that row. Always renders `rowsPerPage` total rows so the
// printed page fills the entire A4 sheet with practice space — empty rows
// have `char === ''` (drawn as a blank ruled line).
const FOUR_LINE_ROWS_PER_PAGE: Record<PaperSize, number> = {
  // Tuned 2026-07-03: was 14/18/11. A4 +2, A3 +3 to fill the page more
  // tightly. B5 limited to +1 (11→12) because the 12pt inter-row gap
  // makes the math tight: 12×(33+12)-12 = 528pt + 73pt header/footer
  // = 601pt ≤ 624pt inner. 13 would be 646pt > 624pt → 2 pages.
  A3: 21,
  B5: 12,
  A4: 16,
  'brush-12': 0,
  'brush-24': 0,
  'brush-28': 0,
};

export function fourLineRowsPerPage(p: PaperSize): number {
  return FOUR_LINE_ROWS_PER_PAGE[p] ?? 14;
}

export function englishCharsPerRow(paperSize: PaperSize): number {
  switch (paperSize) {
    case 'A3':
      return 168;
    case 'A4':
      return 88;
    case 'B5':
      return 48;
    default:
      return cellsPerPage(paperSize);
  }
}

export function generateLayout(content: string[], style: CellStyle, paperSize?: PaperSize): Cell[] {
  if (getPresentation(style) === 'four-line') {
    const perRow = paperSize ? englishCharsPerRow(paperSize) : 88;
    const rowsTotal = paperSize ? fourLineRowsPerPage(paperSize) : 14;
    const cells: Cell[] = [];
    let i = 0;
    let rowIdx = 0;
    while (rowIdx < rowsTotal) {
      const slice = i < content.length ? content.slice(i, i + perRow).join('') : '';
      cells.push({ char: slice, style, index: rowIdx });
      i += perRow;
      rowIdx++;
    }
    return cells;
  }
  // Pad content to the next cellsPerPage(paperSize) multiple so the final
  // page is full of practice cells (empty char === blank cell — WorksheetCell
  // draws the grid/lines but omits the letter). Without this, a 50-char
  // worksheet on A4 (88 cells/page) renders only 50 cells and the page
  // has 38 missing slots — printers / users see a short sheet instead of
  // a full practice page. Math.max guards the empty-content case so we
  // still return one full page of blanks (defensive — UI hides empty
  // previews via canPreview, but the helper must not return []).
  const perPage = cellsPerPage(paperSize ?? 'A4');
  const total = Math.max(perPage, Math.ceil(content.length / perPage) * perPage);
  const cells: Cell[] = [];
  for (let i = 0; i < total; i++) {
    cells.push({ char: i < content.length ? content[i] : '', style, index: i });
  }
  return cells;
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
  if (!(ALL_CELL_STYLES as readonly string[]).includes(input.cellStyle as string)) {
    return {
      ok: false,
      error:
        'cellStyle must be one of: brush-square, brush-cross, pen-square, pen-cross, brush-trace-square, brush-trace-cross, pen-lined, pen-english',
    };
  }
  const cellStyle = input.cellStyle as CellStyle;
  const allowLatin = cellStyle === 'pen-english';
  if (
    !input.content.every(
      (c) => typeof c === 'string' && (allowLatin ? SINGLE_LATIN.test(c) : SINGLE_CJK.test(c)),
    )
  ) {
    return {
      ok: false,
      error: allowLatin
        ? 'content must be A-Z/a-z letters (no spaces or punctuation) when cellStyle=pen-english'
        : 'content must be CJK chars',
    };
  }
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
