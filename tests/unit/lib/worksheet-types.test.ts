import { describe, it, expect } from 'vitest';
import {
  getPresentation,
  cellStyleLabel,
  linedHeightPx,
  linesPerPage,
  PRACTICE_GRID_CELL_SIZE,
  validateWorksheetInput,
} from '@/lib/worksheet-types';

describe('getPresentation — lined branch', () => {
  it('returns "lined" for pen-lined', () => {
    expect(getPresentation('pen-lined')).toBe('lined');
  });
  it('still returns "square" for pen-square / brush-square / brush-trace-square', () => {
    expect(getPresentation('pen-square')).toBe('square');
    expect(getPresentation('brush-square')).toBe('square');
    expect(getPresentation('brush-trace-square')).toBe('square');
  });
  it('still returns "cross" for *-cross / brush-trace-cross', () => {
    expect(getPresentation('pen-cross')).toBe('cross');
    expect(getPresentation('brush-cross')).toBe('cross');
    expect(getPresentation('brush-trace-cross')).toBe('cross');
  });
});

describe('getPresentation — four-line branch (English trace)', () => {
  it('returns "four-line" for pen-english', () => {
    expect(getPresentation('pen-english')).toBe('four-line');
  });
});

describe('cellStyleLabel — four-line branch (English trace)', () => {
  it('labels pen-english as "钢笔·英文描红"', () => {
    expect(cellStyleLabel('pen-english')).toBe('钢笔·英文描红');
  });
});

describe('cellStyleLabel — lined branch', () => {
  it('labels pen-lined as "钢笔·横线"', () => {
    expect(cellStyleLabel('pen-lined')).toBe('钢笔·横线');
  });
  it('still labels existing styles correctly (regression)', () => {
    expect(cellStyleLabel('brush-square')).toBe('毛笔·田字格');
    expect(cellStyleLabel('pen-square')).toBe('钢笔·田字格');
    expect(cellStyleLabel('brush-trace-square')).toBe('毛笔·田字格·描红');
  });
});

describe('linedHeightPx', () => {
  it('A4 = 38px (~1.0cm at 96dpi)', () => {
    expect(linedHeightPx('A4')).toBe(38);
  });
  it('A3 = 38px (1.0cm standard, 36 lines × 38px = 1368px fits 1474px A3 inner)', () => {
    expect(linedHeightPx('A3')).toBe(38);
  });
  it('B5 = 44px (14 lines × 44px = 616px fits 832px B5 inner)', () => {
    expect(linedHeightPx('B5')).toBe(44);
  });
  it('returns 0 for brush-* (lined not supported on brush paper)', () => {
    expect(linedHeightPx('brush-12')).toBe(0);
    expect(linedHeightPx('brush-24')).toBe(0);
    expect(linedHeightPx('brush-28')).toBe(0);
  });
});

describe('linesPerPage', () => {
  it('A4 = 24 lines, A3 = 36 lines, B5 = 14 lines', () => {
    expect(linesPerPage('A4')).toBe(24);
    expect(linesPerPage('A3')).toBe(36);
    expect(linesPerPage('B5')).toBe(14);
  });
  it('returns 0 for brush-* (lined not supported on brush paper)', () => {
    expect(linesPerPage('brush-12')).toBe(0);
    expect(linesPerPage('brush-24')).toBe(0);
    expect(linesPerPage('brush-28')).toBe(0);
  });
});

describe('validateWorksheetInput — accepts pen-lined', () => {
  it('accepts cellStyle="pen-lined" and defaults paperSize to A4 (pen tool)', () => {
    const r = validateWorksheetInput({
      title: '横线练习',
      content: ['一', '二'],
      cellStyle: 'pen-lined',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.cellStyle).toBe('pen-lined');
      expect(r.data.paperSize).toBe('A4');
    }
  });
  it('still rejects unknown cellStyle values', () => {
    const r = validateWorksheetInput({
      title: 'x',
      content: ['一'],
      cellStyle: 'pen-cursive',
    });
    expect(r.ok).toBe(false);
  });
});

describe('validateWorksheetInput — accepts pen-english (ASCII letters only)', () => {
  it('accepts cellStyle="pen-english" with A-Z/a-z letters', () => {
    const r = validateWorksheetInput({
      title: 'English practice',
      content: ['A', 'b', 'C'],
      cellStyle: 'pen-english',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.cellStyle).toBe('pen-english');
      expect(r.data.paperSize).toBe('A4');
    }
  });
  it('rejects pen-english with space content', () => {
    const r = validateWorksheetInput({
      title: 'sp',
      content: ['A', ' '],
      cellStyle: 'pen-english',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/A-Z\/a-z/);
  });
  it('rejects CJK chars when cellStyle is pen-english', () => {
    const r = validateWorksheetInput({
      title: 'x',
      content: ['A', '你'],
      cellStyle: 'pen-english',
    });
    expect(r.ok).toBe(false);
  });
  it('still rejects ASCII letters when cellStyle is CJK (e.g. brush-square)', () => {
    const r = validateWorksheetInput({
      title: 'x',
      content: ['一', 'A'],
      cellStyle: 'brush-square',
    });
    expect(r.ok).toBe(false);
  });
});

describe('PRACTICE_GRID_CELL_SIZE — grid mode cell sizing', () => {
  it('A4 = 70px so 8 cells × 70 + 7 × 8px gap fits A4 printable width AND 11 rows fit height', () => {
    // Width: 8 × 70 + 7 × 8 = 616 CSS px → 462pt (≤ 510pt ✓)
    // Height: 11 × 52.5pt + 10 × 8pt + 73pt header+footer = 730.5pt ≤ 757pt ✓
    // (75px cells would overflow A4 PDF by ~5mm; dropped to 70px for 11 rows = 88 cells)
    expect(PRACTICE_GRID_CELL_SIZE['A4']).toBe(70);
  });
  it('A3 stays at 70px (12 × 70 + 11 × 8 = 928 ≤ 1010 A3 inner)', () => {
    expect(PRACTICE_GRID_CELL_SIZE['A3']).toBe(70);
  });
  it('B5 stays at 80px (6 × 80 + 5 × 8 = 520 ≈ 540 B5 inner)', () => {
    expect(PRACTICE_GRID_CELL_SIZE['B5']).toBe(80);
  });
});