import { describe, it, expect } from 'vitest';
import { sourceForHsk, type HskLevel } from '@/lib/difficulty';

describe('sourceForHsk', () => {
  it('HSK 1 maps to chars-level-1 (smallest pool)', () => {
    expect(sourceForHsk(1)).toBe('chars-level-1');
  });
  it('HSK 2-3 map to chars-level-1-2 (mid pool)', () => {
    expect(sourceForHsk(2)).toBe('chars-level-1-2');
    expect(sourceForHsk(3)).toBe('chars-level-1-2');
  });
  it('HSK 4-6 map to chars-all (full pool, fallback)', () => {
    expect(sourceForHsk(4)).toBe('chars-all');
    expect(sourceForHsk(5)).toBe('chars-all');
    expect(sourceForHsk(6)).toBe('chars-all');
  });
  it('rejects invalid levels at type level (compile-time)', () => {
    // @ts-expect-error — invalid hsk level
    sourceForHsk(99);
  });
});
