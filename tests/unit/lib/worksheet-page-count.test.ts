import { describe, it, expect } from 'vitest';
import { cellsPerPage, pageCountFor, exceedsFreeLimit } from '@/lib/worksheet-page-count';

describe('cellsPerPage', () => {
  it('returns the per-paper-size cell count', () => {
    expect(cellsPerPage('A3')).toBe(132);
    expect(cellsPerPage('A4')).toBe(96);
    expect(cellsPerPage('B5')).toBe(66);
  });
});

describe('pageCountFor', () => {
  it('returns 1 for empty content', () => {
    expect(pageCountFor(0, 'A4')).toBe(1);
  });
  it('returns 1 for exactly cellsPerPage chars', () => {
    expect(pageCountFor(96, 'A4')).toBe(1);
    expect(pageCountFor(132, 'A3')).toBe(1);
    expect(pageCountFor(66, 'B5')).toBe(1);
  });
  it('returns 2 for one over the threshold', () => {
    expect(pageCountFor(97, 'A4')).toBe(2);
    expect(pageCountFor(133, 'A3')).toBe(2);
    expect(pageCountFor(67, 'B5')).toBe(2);
  });
  it('returns correct count for large content', () => {
    expect(pageCountFor(200, 'A4')).toBe(3); // ceil(200/96) = 3
    expect(pageCountFor(500, 'A3')).toBe(4); // ceil(500/132) = 4
  });
});

describe('exceedsFreeLimit', () => {
  it('returns false for single-page content', () => {
    expect(exceedsFreeLimit(1, 'A4')).toBe(false);
    expect(exceedsFreeLimit(96, 'A4')).toBe(false);
  });
  it('returns true for multi-page content', () => {
    expect(exceedsFreeLimit(97, 'A4')).toBe(true);
    expect(exceedsFreeLimit(200, 'A4')).toBe(true);
  });
});