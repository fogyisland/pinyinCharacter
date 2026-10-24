import { describe, it, expect } from 'vitest';
import { getStrokeCount } from '@/lib/stroke-count';

describe('getStrokeCount', () => {
  it('reads the real stroke count from the bundled stroke data', () => {
    // 七 has 2 strokes in public/strokes/七.json
    expect(getStrokeCount('七')).toBe(2);
    expect(getStrokeCount('一')).toBe(1);
  });

  it('returns null for a char without stroke data', () => {
    // The upstream hanzi-writer data covers 6866 of the 7909 chars; the
    // remaining ones have no file at all.
    expect(getStrokeCount('龘')).toBeNull();
  });

  it('returns null for an empty input instead of throwing', () => {
    expect(getStrokeCount('')).toBeNull();
  });

  it('returns null for a char that is not a single CJK char', () => {
    expect(getStrokeCount('AB')).toBeNull();
  });
});
