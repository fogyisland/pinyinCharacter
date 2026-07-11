import { describe, it, expect } from 'vitest';
import {
  Range,
  DEFAULT_RANGE,
  ALL_RANGES,
  parseRange,
  rangeToDays,
  rangeToSinceClause,
} from '@/lib/admin-range';

describe('ALL_RANGES', () => {
  it('exports 1d/7d/30d/90d in order', () => {
    expect(ALL_RANGES).toEqual(['1d', '7d', '30d', '90d']);
  });
});

describe('DEFAULT_RANGE', () => {
  it('is 7d', () => {
    expect(DEFAULT_RANGE).toBe('7d');
  });
});

describe('parseRange', () => {
  it.each(ALL_RANGES)('returns %s for valid value', (r) => {
    expect(parseRange(r)).toBe(r);
  });

  it('returns DEFAULT_RANGE for undefined', () => {
    expect(parseRange(undefined)).toBe(DEFAULT_RANGE);
  });

  it('returns DEFAULT_RANGE for empty string', () => {
    expect(parseRange('')).toBe(DEFAULT_RANGE);
  });

  it('returns DEFAULT_RANGE for unknown value', () => {
    expect(parseRange('999d')).toBe(DEFAULT_RANGE);
    expect(parseRange('last-week')).toBe(DEFAULT_RANGE);
  });

  it('returns DEFAULT_RANGE for array (Next.js searchParams quirk)', () => {
    expect(parseRange(['7d', '30d'])).toBe(DEFAULT_RANGE);
  });
});

describe('rangeToDays', () => {
  it.each([
    ['1d', 1],
    ['7d', 7],
    ['30d', 30],
    ['90d', 90],
  ] as const)('%s → %i', (r, days) => {
    expect(rangeToDays(r)).toBe(days);
  });
});

describe('rangeToSinceClause', () => {
  it('produces DATE_SUB(CURDATE(), INTERVAL ? DAY)', () => {
    expect(rangeToSinceClause('7d').sql).toBe(
      'created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)',
    );
  });

  it('params match rangeToDays', () => {
    expect(rangeToSinceClause('30d').params).toEqual([30]);
    expect(rangeToSinceClause('1d').params).toEqual([1]);
  });
});
