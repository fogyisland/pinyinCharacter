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
  getIsTrace,
  defaultToolFor,
  defaultPresentationFor,
  cellStyleLabel,
} from '@/lib/worksheet-types';
import type { FontFamily } from '@/lib/worksheet-types';

describe('FONT_FAMILIES (G3)', () => {
  it('has 12 entries: 3 system + 3 hard-pen + 6 brush', () => {
    expect(FONT_FAMILIES).toHaveLength(12);
  });

  it('groups entries by system, hard-pen, or brush', () => {
    const groups = new Set(FONT_FAMILIES.map((f) => f.group));
    expect(groups).toEqual(new Set(['system', 'hard-pen', 'brush']));
    const system = FONT_FAMILIES.filter((f) => f.group === 'system').map((f) => f.value);
    const hardPen = FONT_FAMILIES.filter((f) => f.group === 'hard-pen').map((f) => f.value);
    const brush = FONT_FAMILIES.filter((f) => f.group === 'brush').map((f) => f.value);
    expect(system).toEqual(['song', 'kai', 'hei']);
    expect(hardPen).toEqual(['wenkai-gb', 'yozai', 'zen-kaku-thin']);
    expect(brush).toEqual(['iansui', 'ma-shan-zheng', 'long-cang', 'liu-jian-mao-cao', 'zcool-xiaowei', 'zhi-mang-xing']);
  });

  it('covers the FontFamily union', () => {
    const values = new Set(FONT_FAMILIES.map((f) => f.value));
    const expected: FontFamily[] = [
      'song', 'kai', 'hei',
      'wenkai-gb', 'yozai', 'zen-kaku-thin',
      'iansui', 'ma-shan-zheng', 'long-cang',
      'liu-jian-mao-cao', 'zcool-xiaowei', 'zhi-mang-xing',
    ];
    for (const e of expected) expect(values.has(e)).toBe(true);
  });

  it('label/cssVar lookups still work for all 12 values', () => {
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

// ============================================================================
// Task 2 of 描红 feature: brush-trace-{square,cross} cell styles + helpers
// ============================================================================

describe('composeCellStyle with trace (Task 2)', () => {
  it('returns trace variant when tool=brush and trace=true', () => {
    expect(composeCellStyle('brush', 'square', true)).toBe('brush-trace-square');
    expect(composeCellStyle('brush', 'cross', true)).toBe('brush-trace-cross');
  });
  it('returns non-trace variant when trace=false (default)', () => {
    expect(composeCellStyle('brush', 'square')).toBe('brush-square');
    expect(composeCellStyle('brush', 'square', false)).toBe('brush-square');
  });
  it('ignores trace=true when tool=pen (pen has no trace mode)', () => {
    expect(composeCellStyle('pen', 'square', true)).toBe('pen-square');
    expect(composeCellStyle('pen', 'cross', true)).toBe('pen-cross');
  });
});

describe('getIsTrace (Task 2)', () => {
  it('returns true for brush-trace-*', () => {
    expect(getIsTrace('brush-trace-square')).toBe(true);
    expect(getIsTrace('brush-trace-cross')).toBe(true);
  });
  it('returns false for non-trace styles', () => {
    expect(getIsTrace('brush-square')).toBe(false);
    expect(getIsTrace('brush-cross')).toBe(false);
    expect(getIsTrace('pen-square')).toBe(false);
    expect(getIsTrace('pen-cross')).toBe(false);
  });
});

describe('getPresentation with trace styles (Task 2)', () => {
  it('returns square for *-square (including trace)', () => {
    expect(getPresentation('brush-square')).toBe('square');
    expect(getPresentation('brush-trace-square')).toBe('square');
    expect(getPresentation('pen-square')).toBe('square');
  });
  it('returns cross for *-cross (including trace)', () => {
    expect(getPresentation('brush-cross')).toBe('cross');
    expect(getPresentation('brush-trace-cross')).toBe('cross');
    expect(getPresentation('pen-cross')).toBe('cross');
  });
});

describe('cellStyleLabel with trace (Task 2)', () => {
  it('appends ·描红 for brush-trace-*', () => {
    expect(cellStyleLabel('brush-trace-square')).toBe('毛笔·田字格·描红');
    expect(cellStyleLabel('brush-trace-cross')).toBe('毛笔·米字格·描红');
  });
  it('omits ·描红 for non-trace styles (backward compat)', () => {
    expect(cellStyleLabel('brush-square')).toBe('毛笔·田字格');
    expect(cellStyleLabel('pen-cross')).toBe('钢笔·米字格');
  });
});

describe('getTool unchanged for trace (Task 2)', () => {
  it('returns brush for brush-trace-*', () => {
    expect(getTool('brush-trace-square')).toBe('brush');
    expect(getTool('brush-trace-cross')).toBe('brush');
  });
});
