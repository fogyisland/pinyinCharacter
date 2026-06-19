import { describe, it, expect } from 'vitest';
import { cellsPerPage, pageCountFor, exceedsFreeLimit } from '@/lib/worksheet-page-count';

describe('cellsPerPage', () => {
  it('returns the per-paper-size cell count', () => {
    expect(cellsPerPage('A3')).toBe(132);
    expect(cellsPerPage('A4')).toBe(88);
    expect(cellsPerPage('B5')).toBe(60);
  });
});

describe('pageCountFor', () => {
  it('returns 1 for empty content', () => {
    expect(pageCountFor(0, 'A4')).toBe(1);
  });
  it('returns 1 for exactly cellsPerPage chars', () => {
    expect(pageCountFor(88, 'A4')).toBe(1);
    expect(pageCountFor(132, 'A3')).toBe(1);
    expect(pageCountFor(60, 'B5')).toBe(1);
  });
  it('returns 2 for one over the threshold', () => {
    expect(pageCountFor(89, 'A4')).toBe(2);
    expect(pageCountFor(133, 'A3')).toBe(2);
    expect(pageCountFor(61, 'B5')).toBe(2);
  });
  it('returns correct count for large content', () => {
    expect(pageCountFor(200, 'A4')).toBe(3); // ceil(200/88) = 3
    expect(pageCountFor(500, 'A3')).toBe(4); // ceil(500/132) = 4
  });
});

describe('exceedsFreeLimit', () => {
  it('returns false for single-page content', () => {
    expect(exceedsFreeLimit(1, 'A4')).toBe(false);
    expect(exceedsFreeLimit(88, 'A4')).toBe(false);
  });
  it('returns true for multi-page content', () => {
    expect(exceedsFreeLimit(89, 'A4')).toBe(true);
    expect(exceedsFreeLimit(200, 'A4')).toBe(true);
  });
});

describe('cellsPerPage (G3 brush modes)', () => {
  it('returns 12 for brush-12', () => {
    expect(cellsPerPage('brush-12')).toBe(12);
  });
  it('returns 24 for brush-24', () => {
    expect(cellsPerPage('brush-24')).toBe(24);
  });
  it('returns 28 for brush-28', () => {
    expect(cellsPerPage('brush-28')).toBe(28);
  });
});
