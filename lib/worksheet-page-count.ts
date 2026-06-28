import type { PaperSize } from './worksheet-types';

// Conservative real-print capacity (verified by hand: A4 fits 10 rows × 8 cols
// = 80 cells; the prior 88 overflowed one row onto a 2nd sheet). All non-brush
// papers lose one row to leave headroom for the column header + footer line
// rendered inside .worksheet-grid (not visible in the per-cell size calc).
// brush-12/24/28 are fixed (the brush literal is the spec, not a heuristic).
const CELLS_PER_PAGE: Record<PaperSize, number> = {
  A3: 120,        // 12 × 10
  A4: 80,         // 8 × 10
  B5: 54,         // 6 × 9
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
