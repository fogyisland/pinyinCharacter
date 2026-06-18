import type { PaperSize } from './worksheet-types';

const CELLS_PER_PAGE: Record<PaperSize, number> = {
  A3: 132,
  A4: 96,
  B5: 66,
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