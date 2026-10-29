import { describe, it, expect } from 'vitest';
import {
  isCjkChar,
  scoreCharacters,
  planTiers,
  unicodeRange,
  loadFamilyCharsets,
} from '../../../scripts/fonts/webfont-charset.mjs';

describe('isCjkChar', () => {
  it('accepts CJK ideographs and CJK punctuation', () => {
    expect(isCjkChar('一')).toBe(true);   // U+4E00
    expect(isCjkChar('、')).toBe(true);   // U+3001
    expect(isCjkChar('！')).toBe(true);   // U+FF01
    expect(isCjkChar('永')).toBe(true);   // U+6C38
  });

  it('rejects latin, digits, punctuation and accented letters', () => {
    for (const ch of ['a', '1', ' ', '·', 'é', '—', '“']) {
      expect(isCjkChar(ch)).toBe(false);
    }
  });
});

describe('scoreCharacters', () => {
  it('adds the weighted occurrences of every source', () => {
    const scored = scoreCharacters([
      { id: 'corpus', weight: 1, chars: ['永', '永', '永'] },
      { id: 'src', weight: 1000, chars: ['永'] },
    ]);
    expect(scored.score.get('永')).toBe(1003);
  });

  it('orders by descending score, then by ascending code point', () => {
    const scored = scoreCharacters([
      { id: 'corpus', weight: 1, chars: ['永', '一'] },
      { id: 'src', weight: 1000, chars: ['丁'] },
    ]);
    expect(scored.ordered[0]).toBe('丁');
    expect(scored.ordered.slice(1).sort()).toEqual(['一', '永']);
  });

  it('keeps only CJK characters', () => {
    const scored = scoreCharacters([{ id: 'x', weight: 1, chars: ['a', '永'] }]);
    expect(scored.ordered).toEqual(['永']);
  });
});

describe('planTiers', () => {
  const chars = ['一', '丁', '丂', '七', '万', '丈']; // U+4E00..U+4E08
  const scored = scoreCharacters([
    { id: 'x', weight: 1, chars: chars.slice().reverse() },
  ]);

  it('splits into tier1, tier2 and ext blocks', () => {
    const plan = planTiers(scored, { tier1Size: 2, tier2Size: 2, extBlockSize: 2 });
    expect(plan.tier1).toHaveLength(2);
    expect(plan.tier2).toHaveLength(2);
    expect(plan.extBlocks).toHaveLength(2);
    expect(plan.extBlocks[0].chars).toHaveLength(2);
  });

  it('puts every character in exactly one tier', () => {
    const plan = planTiers(scored, { tier1Size: 2, tier2Size: 2, extBlockSize: 2 });
    const all = [...plan.tier1, ...plan.tier2, ...plan.extBlocks.flatMap((b) => b.chars)];
    expect(new Set(all).size).toBe(all.length);
    expect([...all].sort()).toEqual([...chars].sort());
  });

  it('defaults to 200 / 600 / 256', () => {
    const big = scoreCharacters([
      { id: 'x', weight: 1, chars: Array.from({ length: 2000 }, (_, i) => String.fromCodePoint(0x4e00 + i)) },
    ]);
    const plan = planTiers(big);
    expect(plan.tier1).toHaveLength(200);
    expect(plan.tier2).toHaveLength(600);
    expect(plan.extBlocks.length).toBeGreaterThan(0);
    expect(plan.extBlocks.every((b) => b.chars.length <= 256)).toBe(true);
  });

  it('makes one ext block when the remainder fits in one', () => {
    const plan = planTiers(scored, { tier1Size: 4, tier2Size: 0, extBlockSize: 256 });
    expect(plan.extBlocks).toHaveLength(1);
  });
});

describe('unicodeRange', () => {
  it('merges consecutive code points into one range', () => {
    expect(unicodeRange(['一', '丁'])).toBe('U+4E00-4E01');
  });

  it('keeps a gap as two ranges', () => {
    expect(unicodeRange(['一', '七'])).toBe('U+4E00, U+4E03');
  });

  it('emits a bare code point for a single character', () => {
    expect(unicodeRange(['一'])).toBe('U+4E00');
  });

  it('returns an empty string for no characters', () => {
    expect(unicodeRange([])).toBe('');
  });
});

describe('loadFamilyCharsets', () => {
  it(
    'builds nested charsets: wenkai ⊂ sans ⊂ serif',
    () => {
      const plans = loadFamilyCharsets();
      const size = (p: { tier1: string[]; tier2: string[]; extBlocks: { chars: string[] }[] }) =>
        p.tier1.length + p.tier2.length + p.extBlocks.flatMap((b) => b.chars).length;
      expect(size(plans.wenkai)).toBeGreaterThan(0);
      expect(size(plans.wenkai)).toBeLessThan(size(plans.sans));
      expect(size(plans.sans)).toBeLessThanOrEqual(size(plans.serif));
    },
    180_000,
  );

  it('covers the UI literals and the corpus characters', () => {
    const plans = loadFamilyCharsets();
    const sans = new Set(
      [...plans.sans.tier1, ...plans.sans.tier2, ...plans.sans.extBlocks.flatMap((b) => b.chars)],
    );
    for (const ch of ['字', '韵', '一', '永', '故', '唐']) {
      expect(sans.has(ch)).toBe(true);
    }
  }, 180_000);
});
