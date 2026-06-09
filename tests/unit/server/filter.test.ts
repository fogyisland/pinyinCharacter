import { describe, it, expect } from 'vitest';
import { filterCandidates } from '@/server/filter';
import type { DictEntry } from '@/server/dictionary';

const sample: DictEntry[] = [
  { char: '你', freq: 100 },
  { char: '脏字A', freq: 80 },
  { char: '好', freq: 90 },
];

describe('filterCandidates', () => {
  it('returns all when safeMode is false', () => {
    expect(filterCandidates(sample, false)).toEqual(sample);
  });

  it('removes bad chars when safeMode is true', () => {
    const badChars = new Set<string>(['脏字A']);
    const out = filterCandidates(sample, true, badChars);
    expect(out).toHaveLength(2);
    expect(out.find(c => c.char === '脏字A')).toBeUndefined();
  });

  it('returns empty when all are bad', () => {
    const all: DictEntry[] = [{ char: '脏1', freq: 1 }];
    const badChars = new Set<string>(['脏1']);
    expect(filterCandidates(all, true, badChars)).toEqual([]);
  });
});
