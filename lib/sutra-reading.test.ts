import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SUTRA_READING,
  SUTRA_READING_LABELS,
  type SutraReading,
} from './sutra-reading';

describe('sutra-reading', () => {
  it('exports 3 reading modes', () => {
    expect(Object.keys(SUTRA_READING_LABELS)).toEqual([
      'horizontal',
      'vertical-rtl',
      'vertical-ltr',
    ]);
  });

  it('default is horizontal', () => {
    expect(DEFAULT_SUTRA_READING).toBe('horizontal');
  });

  it('every mode has a Chinese label', () => {
    const modes: SutraReading[] = ['horizontal', 'vertical-rtl', 'vertical-ltr'];
    for (const m of modes) {
      expect(SUTRA_READING_LABELS[m]).toMatch(/[一-鿿]/);
    }
  });
});