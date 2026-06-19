import { describe, it, expect } from 'vitest';
import { FONT_FAMILIES, fontFamilyLabel, fontFamilyCssVar } from '@/lib/worksheet-types';
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