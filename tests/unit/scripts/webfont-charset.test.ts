import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
  const chars = ['一', '丁', '丂', '七', '万', '丈']; // U+4E00..U+4E05
  const scored = scoreCharacters([
    { id: 'x', weight: 1, chars: chars.slice().reverse() },
  ]);

  it('puts the hottest characters in the hot tier', () => {
    const plan = planTiers(scored, { tier1Size: 2 });
    expect(plan.hot).toHaveLength(2);
  });

  it('cuts the tail into code point windows, not character slices', () => {
    // The tail after a 2 character hot tier is 丂(U+4E02), 七(U+4E03),
    // 万(U+4E07) and 丈(U+4E08) — 万 and 丈 are NOT U+4E04 and U+4E05.
    // Windows of 2 code points are [U+4E02,U+4E04), [U+4E04,U+4E06),
    // [U+4E06,U+4E08) and [U+4E08,U+4E0A), so the tail falls into three
    // of them: a chunking by character count would have put 万 and 丈 into
    // the block of 丂 and 七.
    const plan = planTiers(scored, { tier1Size: 2, extBlockSize: 2 });
    expect(plan.extBlocks).toHaveLength(3);
    expect(plan.extBlocks[0].chars).toEqual(['丂', '七']);
    expect(plan.extBlocks[0].lo).toBe(0x4e02);
    expect(plan.extBlocks[0].hi).toBe(0x4e03);
    expect(plan.extBlocks[1].chars).toEqual(['万']);
    expect(plan.extBlocks[1].lo).toBe(0x4e07);
    expect(plan.extBlocks[1].hi).toBe(0x4e07);
    expect(plan.extBlocks[2].chars).toEqual(['丈']);
    expect(plan.extBlocks[2].lo).toBe(0x4e08);
    expect(plan.extBlocks[2].hi).toBe(0x4e08);
  });

  it('numbers the ext blocks from 1, contiguously', () => {
    const plan = planTiers(scored, { tier1Size: 2, extBlockSize: 2 });
    expect(plan.extBlocks.map((b) => b.index)).toEqual([1, 2, 3]);
  });

  it('puts every character in exactly one tier', () => {
    const plan = planTiers(scored, { tier1Size: 2, extBlockSize: 2 });
    const all = [...plan.hot, ...plan.extBlocks.flatMap((b) => b.chars)];
    expect(new Set(all).size).toBe(all.length);
    expect([...all].sort()).toEqual([...chars].sort());
  });

  it('gives every ext block a disjoint code point span', () => {
    const plan = planTiers(scored, { tier1Size: 2, extBlockSize: 2 });
    const spans = plan.extBlocks.map((b) => [b.lo, b.hi]);
    for (let i = 1; i < spans.length; i++) {
      expect(spans[i][0]).toBeGreaterThan(spans[i - 1][1]);
    }
  });

  it('defaults to a 300 character hot tier and 16 code point windows', () => {
    const big = scoreCharacters([
      { id: 'x', weight: 1, chars: Array.from({ length: 2000 }, (_, i) => String.fromCodePoint(0x4e00 + i)) },
    ]);
    const plan = planTiers(big);
    expect(plan.hot).toHaveLength(300);
    expect(plan.extBlocks.length).toBeGreaterThan(0);
    expect(plan.extBlocks.every((b) => b.hi - b.lo < 16)).toBe(true);
  });

  it('never produces an empty ext block', () => {
    const big = scoreCharacters([
      { id: 'x', weight: 1, chars: Array.from({ length: 2000 }, (_, i) => String.fromCodePoint(0x4e00 + i)) },
    ]);
    const plan = planTiers(big, { tier1Size: 300, extBlockSize: 16 });
    expect(plan.extBlocks.every((b) => b.chars.length > 0)).toBe(true);
  });

  it('never repeats a character between the hot tier and an ext block', () => {
    const big = scoreCharacters([
      { id: 'x', weight: 1, chars: Array.from({ length: 2000 }, (_, i) => String.fromCodePoint(0x4e00 + i)) },
    ]);
    const plan = planTiers(big, { tier1Size: 300, extBlockSize: 16 });
    const hot = new Set(plan.hot);
    expect(plan.extBlocks.some((b) => b.chars.some((c) => hot.has(c)))).toBe(false);
  });

  it('rejects a non positive window width', () => {
    expect(() => planTiers(scored, { extBlockSize: 0 })).toThrow();
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
  const charsetOf = (plan: { hot: string[]; extBlocks: { chars: string[] }[] }) =>
    new Set([...plan.hot, ...plan.extBlocks.flatMap((b) => b.chars)]);

  it(
    'builds nested charsets: wenkai ⊂ sans ⊂ serif',
    () => {
      const plans = loadFamilyCharsets();
      const size = (p: { hot: string[]; extBlocks: { chars: string[] }[] }) =>
        p.hot.length + p.extBlocks.flatMap((b) => b.chars).length;
      expect(size(plans.wenkai)).toBeGreaterThan(0);
      expect(size(plans.wenkai)).toBeLessThan(size(plans.sans));
      expect(size(plans.sans)).toBeLessThanOrEqual(size(plans.serif));
    },
    180_000,
  );

  it('uses the per family hot tier sizes from the rulings', () => {
    const plans = loadFamilyCharsets();
    expect(plans.sans.hot).toHaveLength(300);
    expect(plans.serif.hot).toHaveLength(300);
    expect(plans.wenkai.hot).toHaveLength(0);
  }, 180_000);

  it('covers the UI literals and the corpus characters', () => {
    const plans = loadFamilyCharsets();
    const sans = new Set(
      [...plans.sans.hot, ...plans.sans.extBlocks.flatMap((b) => b.chars)],
    );
    for (const ch of ['字', '韵', '一', '永', '故', '唐']) {
      expect(sans.has(ch)).toBe(true);
    }
  }, 180_000);

  it('covers the rare characters in wenkai and in sans', () => {
    const plans = loadFamilyCharsets();
    const wenkai = charsetOf(plans.wenkai);
    const sans = charsetOf(plans.sans);
    // 㑇 and 㕮 are rare characters: data/content/<char>.json holds a
    // `rare` object for them, and the story page renders the character
    // itself in font-kai, so the brand face has to carry them.
    for (const ch of ['㑇', '㕮']) {
      expect(wenkai.has(ch)).toBe(true);
      expect(sans.has(ch)).toBe(true);
    }
  }, 180_000);

  it('puts every dictionary radical in the wenkai charset', () => {
    const plans = loadFamilyCharsets();
    const wenkai = charsetOf(plans.wenkai);
    const sans = charsetOf(plans.sans);
    const serif = charsetOf(plans.serif);
    // 戶 and 韭 are the two radicals the source literals miss — the
    // dictionary spells 戶 as the simplified 户 and omits 韭 entirely.
    expect(wenkai.has('戶')).toBe(true);
    expect(wenkai.has('韭')).toBe(true);
    for (const ch of wenkai) expect(sans.has(ch)).toBe(true);
    for (const ch of sans) expect(serif.has(ch)).toBe(true);
  }, 180_000);

  it('covers every standard character in wenkai, because the chain game paints them in the brand face', () => {
    const plans = loadFamilyCharsets();
    const wenkai = charsetOf(plans.wenkai);
    const standard = JSON.parse(
      readFileSync(
        resolve(process.cwd(), 'data/general-standard-chinese-characters.json'),
        'utf8',
      ),
    ) as string[];
    expect(standard).toHaveLength(8105);
    expect(standard.filter((ch) => !wenkai.has(ch))).toEqual([]);
  }, 180_000);

  it('keeps the wenkai charset inside the measured bounds', () => {
    const plans = loadFamilyCharsets();
    const size = plans.wenkai.hot.length + plans.wenkai.extBlocks.flatMap((b) => b.chars).length;
    // The lower bound is the 8 105 standard characters of R16; the upper
    // bound catches an accidental scan of the 70 234 KEYS of
    // data/radicals.json, which are a lookup table that is never rendered.
    expect(size).toBeGreaterThanOrEqual(8105);
    expect(size).toBeLessThan(9000);
  }, 180_000);

  it('honours a per family override even after the default plans were cached', () => {
    loadFamilyCharsets();
    const plans = loadFamilyCharsets({ families: { sans: { tier1Size: 10 } } });
    expect(plans.sans.hot).toHaveLength(10);
  }, 180_000);
});
