import type { PaperSize } from './worksheet-types';

// Verified real-print capacity per paper size. Each row keeps headroom for
// the column header + footer line rendered inside .worksheet-grid (~80px),
// which the per-cell size calc alone can't see. The cell size used to render
// is in PRACTICE_LAYOUT (lib/worksheet-types.ts) and varies per paper so
// each fits its printable area cleanly. brush-12/24/28 are fixed literals
// (the brush spec, not a heuristic).
const CELLS_PER_PAGE: Record<PaperSize, number> = {
  A3: 168,        // 12 cols × 14 rows, 70px cells (fills the bigger paper)
  A4: 88,         // 8 cols × 11 rows,  70px cells (75px overflowed A4 PDF by ~5mm)
  B5: 48,         // 6 cols × 8 rows,   80px cells (54 overflowed one row)
  'brush-12': 12,
  'brush-24': 24,
  'brush-28': 28,
};

export function cellsPerPage(paperSize: PaperSize): number {
  return CELLS_PER_PAGE[paperSize];
}

export function pageCountFor(contentLength: number, paperSize: PaperSize): number {
  const per = cellsPerPage(paperSize);
  return Math.max(1, Math.ceil(contentLength / per));
}

export function exceedsFreeLimit(contentLength: number, paperSize: PaperSize): boolean {
  return pageCountFor(contentLength, paperSize) > 1;
}
