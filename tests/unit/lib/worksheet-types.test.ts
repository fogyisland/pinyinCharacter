import { describe, it, expect } from 'vitest';
import {
  FONT_FAMILIES,
  fontFamilyLabel,
  fontFamilyCssVar,
  BRUSH_PAPER_SIZES,
  isBrushSize,
  validateWorksheetInput,
  defaultFontFor,
  composeCellStyle,
  getTool,
  getPresentation,
  defaultToolFor,
  defaultPresentationFor,
  cellStyleLabel,
} from '@/lib/worksheet-types';
import type { FontFamily } from '@/lib/worksheet-types';

describe('FONT_FAMILIES (G3)', () => {
  it('has 9 entries: 3 system + 4 hard-pen + 2 brush', () => {
    expect(FONT_FAMILIES).toHaveLength(9);
  });

  it('groups entries by system, hard-pen, or brush', () => {
    const groups = new Set(FONT_FAMILIES.map((f) => f.group));
    expect(groups).toEqual(new Set(['system', 'hard-pen', 'brush']));
    const system = FONT_FAMILIES.filter((f) => f.group === 'system').map((f) => f.value);
    const hardPen = FONT_FAMILIES.filter((f) => f.group === 'hard-pen').map((f) => f.value);
    const brush = FONT_FAMILIES.filter((f) => f.group === 'brush').map((f) => f.value);
    expect(system).toEqual(['song', 'kai', 'hei']);
    expect(hardPen).toEqual(['wenkai-gb', 'yozai', 'iansui', 'zen-kaku-thin']);
    expect(brush).toEqual(['ma-shan-zheng', 'long-cang']);
  });

  it('covers the FontFamily union', () => {
    const values = new Set(FONT_FAMILIES.map((f) => f.value));
    const expected: FontFamily[] = [
      'song', 'kai', 'hei',
      'wenkai-gb', 'yozai', 'iansui', 'zen-kaku-thin',
      'ma-shan-zheng', 'long-cang',
    ];
    for (const e of expected) expect(values.has(e)).toBe(true);
  });

  it('label/cssVar lookups still work for all 9 values', () => {
    for (const f of FONT_FAMILIES) {
      expect(fontFamilyLabel(f.value)).toBe(f.label);
      expect(fontFamilyCssVar(f.value)).toBe(f.cssVar);
    }
  });
});

describe('isBrushSize + BRUSH_PAPER_SIZES (G3)', () => {
  it('BRUSH_PAPER_SIZES contains the 3 brush values in order', () => {
    expect(BRUSH_PAPER_SIZES).toEqual(['brush-12', 'brush-24', 'brush-28']);
  });

  it('isBrushSize returns true for brush modes', () => {
    expect(isBrushSize('brush-12')).toBe(true);
    expect(isBrushSize('brush-24')).toBe(true);
    expect(isBrushSize('brush-28')).toBe(true);
  });

  it('isBrushSize returns false for A3/A4/B5', () => {
    expect(isBrushSize('A3')).toBe(false);
    expect(isBrushSize('A4')).toBe(false);
    expect(isBrushSize('B5')).toBe(false);
  });
});

describe('validateWorksheetInput (G3 paperSize guard)', () => {
  const base = { title: 't', content: ['不'], cellStyle: 'brush-cross' as const };

  it('accepts paperSize brush-12', () => {
    const r = validateWorksheetInput({ ...base, paperSize: 'brush-12' });
    expect(r.ok).toBe(true);
  });

  it('accepts paperSize brush-24', () => {
    const r = validateWorksheetInput({ ...base, paperSize: 'brush-24' });
    expect(r.ok).toBe(true);
  });

  it('accepts paperSize brush-28', () => {
    const r = validateWorksheetInput({ ...base, paperSize: 'brush-28' });
    expect(r.ok).toBe(true);
  });

  it('rejects paperSize "nonsense"', () => {
    const r = validateWorksheetInput({ ...base, paperSize: 'nonsense' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/paperSize must be/);
  });
});

describe('defaultFontFor (G5)', () => {
  it('brush tool → ma-shan-zheng', () => {
    expect(defaultFontFor('brush')).toBe('ma-shan-zheng');
  });
  it('pen tool → wenkai-gb', () => {
    expect(defaultFontFor('pen')).toBe('wenkai-gb');
  });
});

describe('composeCellStyle / getTool / getPresentation (G5)', () => {
  it('round-trips brush-square', () => {
    const s = composeCellStyle('brush', 'square');
    expect(s).toBe('brush-square');
    expect(getTool(s)).toBe('brush');
    expect(getPresentation(s)).toBe('square');
  });
  it('round-trips pen-cross', () => {
    const s = composeCellStyle('pen', 'cross');
    expect(s).toBe('pen-cross');
    expect(getTool(s)).toBe('pen');
    expect(getPresentation(s)).toBe('cross');
  });
});

describe('defaultToolFor / defaultPresentationFor (G5)', () => {
  it('defaultToolFor() returns brush (matches G3 default)', () => {
    expect(defaultToolFor()).toBe('brush');
  });
  it('defaultPresentationFor() returns square', () => {
    expect(defaultPresentationFor()).toBe('square');
  });
});

describe('cellStyleLabel (G5)', () => {
  it('renders brush-square as 毛笔·田字格', () => {
    expect(cellStyleLabel('brush-square')).toBe('毛笔·田字格');
  });
  it('renders pen-cross as 钢笔·米字格', () => {
    expect(cellStyleLabel('pen-cross')).toBe('钢笔·米字格');
  });
});
