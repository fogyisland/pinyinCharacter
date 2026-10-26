import type { CellStyle, FontFamily, PaperSize } from './worksheet-types';

/**
 * The catalogue of standard worksheet formats.
 *
 * A *scheme* is a named format: a cell style + a paper size + a font. The
 * site has no such catalogue today (the practice-template page offers free
 * selectors), so this is new — but it is written as **data**, not code, so
 * the site's own practice-template page can adopt it later without a rewrite,
 * and the MCP tools can offer a caller a ready-made sheet instead of three
 * separate choices.
 *
 * Every `cellStyle`, `paperSize` and `fontFamily` in here must be one the
 * site already knows; a unit test asserts that against lib/worksheet-types.ts.
 */
export interface WorksheetScheme {
  /** The stable id callers use to ask for this scheme. */
  id: string;
  /** The English label. */
  name: string;
  /** The Chinese label. */
  nameZh: string;
  /** The shape of one practice cell. */
  cellStyle: CellStyle;
  /** The sheet the cells are laid out on. */
  paperSize: PaperSize;
  /** The font the characters are written in. */
  fontFamily: FontFamily;
  /** One line, English — what this scheme is good for. */
  note: string;
}

/** The catalogue, in the order the tools list it. */
export const WORKSHEET_SCHEMES: readonly WorksheetScheme[] = [
  {
    id: 'pen-grid-a4',
    name: 'Pen · Grid · A4',
    nameZh: '钢笔·田字格·A4',
    cellStyle: 'pen-square',
    paperSize: 'A4',
    fontFamily: 'wenkai-gb',
    note: 'the everyday hard-pen sheet — a square cell with faint cross guides',
  },
  {
    id: 'pen-cross-a4',
    name: 'Pen · Cross · A4',
    nameZh: '钢笔·米字格·A4',
    cellStyle: 'pen-cross',
    paperSize: 'A4',
    fontFamily: 'wenkai-gb',
    note: 'for the strokes that need every diagonal — a full 米-character guide',
  },
  {
    id: 'pen-lattice-a3',
    name: 'Pen · Cross · A3',
    nameZh: '钢笔·米字格·A3',
    cellStyle: 'pen-cross',
    paperSize: 'A3',
    fontFamily: 'wenkai-gb',
    note: 'the 米-character guide on a big A3 sheet — room for long practice runs',
  },
  {
    id: 'pen-grid-b5',
    name: 'Pen · Grid · B5',
    nameZh: '钢笔·田字格·B5',
    cellStyle: 'pen-square',
    paperSize: 'B5',
    fontFamily: 'wenkai-gb',
    note: 'the same square cell on a pocket-sized sheet — good for one lesson',
  },
  {
    id: 'pen-lined-a4',
    name: 'Pen · Lined · A4',
    nameZh: '钢笔·横线·A4',
    cellStyle: 'pen-lined',
    paperSize: 'A4',
    fontFamily: 'wenkai-gb',
    note: 'ruled lines instead of cells — for writing characters inside a sentence',
  },
  {
    id: 'pen-english-a4',
    name: 'Pen · Four-line · A4',
    nameZh: '钢笔·四线格·A4',
    cellStyle: 'pen-english',
    paperSize: 'A4',
    fontFamily: 'wenkai-gb',
    note: 'the four-line sheet for practising Latin letters and their spacing',
  },
  {
    id: 'brush-grid-a4',
    name: 'Brush · Grid · A4',
    nameZh: '毛笔·田字格·A4',
    cellStyle: 'brush-square',
    paperSize: 'A4',
    fontFamily: 'ma-shan-zheng',
    note: 'brush practice in a square cell — the standard 毛笔 exercise sheet',
  },
  {
    id: 'brush-cross-a4',
    name: 'Brush · Cross · A4',
    nameZh: '毛笔·米字格·A4',
    cellStyle: 'brush-cross',
    paperSize: 'A4',
    fontFamily: 'ma-shan-zheng',
    note: 'the 米-character guide for brush work — where the strokes meet the centre',
  },
  {
    id: 'brush-lattice-a3',
    name: 'Brush · Cross · A3',
    nameZh: '毛笔·米字格·A3',
    cellStyle: 'brush-cross',
    paperSize: 'A3',
    fontFamily: 'ma-shan-zheng',
    note: 'a big brush sheet — 168 米-character cells on one A3 page',
  },
  {
    id: 'brush-grid-b5',
    name: 'Brush · Grid · B5',
    nameZh: '毛笔·田字格·B5',
    cellStyle: 'brush-square',
    paperSize: 'B5',
    fontFamily: 'ma-shan-zheng',
    note: 'a small brush sheet for a short daily practice',
  },
  {
    id: 'brush-trace-a4',
    name: 'Brush · Trace · A4',
    nameZh: '毛笔·描红·A4',
    cellStyle: 'brush-trace-square',
    paperSize: 'A4',
    fontFamily: 'ma-shan-zheng',
    note: 'the character is printed faintly in the cell — trace over it',
  },
  {
    id: 'brush-trace-cross-a4',
    name: 'Brush · Trace · A4 · Cross',
    nameZh: '毛笔·描红米字·A4',
    cellStyle: 'brush-trace-cross',
    paperSize: 'A4',
    fontFamily: 'ma-shan-zheng',
    note: 'tracing on a 米-character guide — see the whole structure while copying',
  },
  {
    id: 'brush-large-12',
    name: 'Brush · 12 cells',
    nameZh: '毛笔·大格·12格',
    cellStyle: 'brush-square',
    paperSize: 'brush-12',
    fontFamily: 'ma-shan-zheng',
    note: 'twelve very large cells — one character at a time, with room to breathe',
  },
  {
    id: 'brush-medium-24',
    name: 'Brush · 24 cells',
    nameZh: '毛笔·中格·24格',
    cellStyle: 'brush-square',
    paperSize: 'brush-24',
    fontFamily: 'ma-shan-zheng',
    note: 'twenty-four medium cells — a balanced daily brush sheet',
  },
  {
    id: 'brush-small-28',
    name: 'Brush · 28 cells',
    nameZh: '毛笔·小格·28格',
    cellStyle: 'brush-square',
    paperSize: 'brush-28',
    fontFamily: 'ma-shan-zheng',
    note: 'twenty-eight small cells — the most characters on one sheet',
  },
  {
    id: 'brush-grid-a3',
    name: 'Brush · Grid · A3',
    nameZh: '毛笔·田字格·A3',
    cellStyle: 'brush-square',
    paperSize: 'A3',
    fontFamily: 'ma-shan-zheng',
    note: 'the square brush cell on a big A3 sheet — 168 characters per page',
  },
];

/**
 * The scheme with that id, or undefined when the catalogue does not hold it.
 *
 * The lookup is a linear scan: the catalogue is sixteen entries, and a Map
 * would only be faster in a way that does not matter here.
 */
export function findScheme(id: string): WorksheetScheme | undefined {
  return WORKSHEET_SCHEMES.find((scheme) => scheme.id === id);
}
