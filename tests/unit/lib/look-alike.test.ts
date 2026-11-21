// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  compareChars,
  findLookAlikes,
  meanDistance,
  prepareChar,
  sampleStroke,
  signatureGap,
  signatureOf,
  buildLookAlikeTable,
  MEAN_LIMIT,
  MAX_LIMIT,
  type Stroke,
} from '@/lib/look-alike';

/**
 * 形近字 — the look-alike comparison.
 *
 * The rule is narrow on purpose: MOST strokes must coincide and EXACTLY ONE
 * must differ. Similarity alone is not enough (木 and 林 are similar), and
 * the tests below pin both sides of that line with real stroke data from
 * public/strokes, so the module is measured against glyphs rather than
 * against a mock.
 */

/** Load a character's real stroke data. */
function strokesOf(char: string): Stroke[] {
  const raw = JSON.parse(
    readFileSync(join(process.cwd(), 'public', 'strokes', `${char}.json`), 'utf-8'),
  ) as { medians: Stroke[] };
  return raw.medians;
}

function prepared(char: string) {
  return prepareChar(char, strokesOf(char));
}

describe('the geometry helpers', () => {
  it('samples a straight stroke evenly by arc length', () => {
    const points = sampleStroke([[0, 0], [100, 0]], 5);
    expect(points).toHaveLength(5);
    expect(points[0]).toEqual([0, 0]);
    expect(points[4]).toEqual([100, 0]);
    // Even spacing along the line.
    expect(points[2][0]).toBeCloseTo(50, 5);
  });

  it('samples a bent stroke without clustering on the straight half', () => {
    // Half the length horizontal, half vertical: the midpoint must be the
    // corner, not the middle of the horizontal half.
    const points = sampleStroke([[0, 0], [50, 0], [50, 50]], 5);
    expect(points[2][0]).toBeCloseTo(50, 5);
    expect(points[2][1]).toBeCloseTo(0, 5);
  });

  it('measures the mean distance between two samples', () => {
    expect(meanDistance([[0, 0], [10, 0]], [[0, 0], [10, 0]])).toBe(0);
    expect(meanDistance([[0, 0]], [[3, 4]])).toBe(5);
  });

  it('counts the entries two signatures do not share', () => {
    expect(signatureGap(['h00', 's11'], ['h00', 's11'])).toBe(0);
    expect(signatureGap(['h00', 's11'], ['h00'])).toBe(1);
    expect(signatureGap(['h00', 's11'], ['h00', 's11', 'p22'])).toBe(1);
    expect(signatureGap(['h00', 's11'], ['h01', 's12'])).toBe(2);
  });

  it('buckets the same relative position identically in two different glyphs', () => {
    // The normalisation that makes 白/自 comparable: the same stroke at the
    // same RELATIVE place must land in the same bucket even when one glyph
    // is taller.
    const small: Stroke[] = [[[100, 100], [200, 100]]];
    const tall: Stroke[] = [
      [[100, 100], [200, 100]],
      [[150, 100], [150, 300]],
    ];
    // Both contain a horizontal across the upper-left area; the signatures
    // must share at least that entry.
    const gap = signatureGap(signatureOf(small), signatureOf(tall));
    expect(gap).toBeLessThanOrEqual(1);
  });
});

describe('compareChars — pairs a teacher would teach', () => {
  const CASES: Array<[string, string]> = [
    ['未', '末'],
    ['己', '已'],
    ['己', '巳'],
    ['土', '士'],
    ['大', '太'],
    ['大', '犬'],
    ['木', '本'],
    ['本', '末'],
    ['日', '曰'],
    ['天', '夫'],
    ['白', '自'],
    ['目', '日'],
    ['王', '玉'],
    ['石', '右'],
    ['中', '申'],
    ['刀', '力'],
  ];

  it('recognises every pair a teacher would call 形近字', () => {
    const missed: string[] = [];
    for (const [a, b] of CASES) {
      const comparison = compareChars(prepared(a), prepared(b));
      if (!comparison?.isLookAlike) missed.push(`${a}/${b}`);
    }
    expect(missed, `missed pairs: ${missed.join(', ')}`).toEqual([]);
  });

  it('reports the same mean whichever way round the pair is measured', () => {
    // The table is symmetric by construction; the API must agree.
    const forward = compareChars(prepared('未'), prepared('末'));
    const backward = compareChars(prepared('末'), prepared('未'));
    expect(forward?.mean).toBeCloseTo(backward?.mean ?? -1, 6);
    expect(forward?.max).toBeCloseTo(backward?.max ?? -1, 6);
  });

  it('points at the stroke that differs', () => {
    // 未/末 differ in ONE horizontal: the engine must be able to say which,
    // because the UI highlights it.
    const comparison = compareChars(prepared('未'), prepared('末'));
    expect(comparison).not.toBeNull();
    expect(comparison?.diffStrokeA).toBeGreaterThanOrEqual(0);
    expect(comparison?.diffStrokeB).toBeGreaterThanOrEqual(0);
  });
});

describe('compareChars — pairs a teacher would NOT call 形近字', () => {
  const NOT_LOOK_ALIKE: Array<[string, string]> = [
    ['上', '下'],
    ['山', '川'],
    ['日', '月'],
    ['木', '林'],
    ['大', '水'],
  ];

  it('rejects characters whose strokes differ throughout', () => {
    for (const [a, b] of NOT_LOOK_ALIKE) {
      const comparison = compareChars(prepared(a), prepared(b));
      // A pair with a different stroke count by more than one is not even
      // compared; that is also a correct rejection.
      expect(comparison?.isLookAlike ?? false, `${a}/${b} must not be 形近`).toBe(false);
    }
  });

  it('rejects a pair whose stroke counts differ by two or more', () => {
    expect(compareChars(prepared('木'), prepared('林'))).toBeNull();
  });

  it('rejects similar-looking pairs whose ONE stroke is not the difference', () => {
    // 日 and 月 both have four strokes, but the 月's strokes bend differently
    // throughout — similarity alone must not qualify them.
    const comparison = compareChars(prepared('日'), prepared('月'));
    expect(comparison?.isLookAlike ?? false).toBe(false);
  });
});

describe('the thresholds', () => {
  it('keeps the mean limit tight enough to reject a whole-glyph difference', () => {
    // 上/下 is the canonical "not a confusion pair": its mean is ~0.32.
    const comparison = compareChars(prepared('上'), prepared('下'));
    expect(comparison?.mean ?? 0).toBeGreaterThan(MEAN_LIMIT);
  });

  it('keeps the max limit low enough to catch a dot that moved slightly', () => {
    // 玉's dot is only 17/1024 from 王's — small, but it is the whole
    // difference, and a learner who misses it writes 王.
    const comparison = compareChars(prepared('王'), prepared('玉'));
    expect(comparison?.max ?? 0).toBeGreaterThanOrEqual(MAX_LIMIT);
    expect(comparison?.isLookAlike).toBe(true);
  });
});

describe('findLookAlikes', () => {
  it('finds the look-alikes of 大 from a small corpus', () => {
    const corpus = ['大', '太', '犬', '天', '夫', '水', '山'].map(prepared);
    const target = prepared('大');
    const found = findLookAlikes(target, corpus);
    const chars = found.map((entry) => entry.char);
    expect(chars).toContain('太');
    expect(chars).toContain('犬');
    expect(chars).not.toContain('水');
    expect(chars).not.toContain('山');
  });

  it('ranks the closest look-alike first', () => {
    const found = findLookAlikes(prepared('大'), ['大', '太', '犬', '夭', '天'].map(prepared));
    // 太 differs by one dot next to 大; 夭 by a slanted stroke.
    expect(found[0]?.char).toBe('太');
  });

  it('respects the cap', () => {
    const many = ['大', '太', '犬', '天', '夫', '夭', '丈', '尤', '友', '夫'].map(prepared);
    const found = findLookAlikes(prepared('大'), many, 3);
    expect(found).toHaveLength(3);
  });

  it('returns nothing when the corpus has no near neighbours', () => {
    expect(findLookAlikes(prepared('山'), ['水', '川'].map(prepared))).toEqual([]);
  });
});

describe('buildLookAlikeTable', () => {
  it('writes both directions of every pair', () => {
    const corpus = ['未', '末', '木'].map(prepared);
    const { table } = buildLookAlikeTable(corpus);
    expect(table['未']?.map((entry) => entry.char)).toContain('末');
    expect(table['末']?.map((entry) => entry.char)).toContain('未');
  });

  it('is symmetric in the numbers too, not just the names', () => {
    const corpus = ['未', '末'].map(prepared);
    const { table } = buildLookAlikeTable(corpus);
    const forward = table['未']?.find((entry) => entry.char === '末');
    const backward = table['末']?.find((entry) => entry.char === '未');
    expect(forward?.mean).toBeCloseTo(backward?.mean ?? -1, 6);
  });

  it('measures each unordered pair once', () => {
    // Two characters: exactly one comparison.
    const corpus = ['未', '末'].map(prepared);
    const { pairsMeasured } = buildLookAlikeTable(corpus);
    expect(pairsMeasured).toBe(1);
  });

  it('caps the list per character', () => {
    const corpus = ['大', '太', '犬', '天', '夫', '夭', '丈', '尤'].map(prepared);
    const { table } = buildLookAlikeTable(corpus);
    for (const list of Object.values(table)) {
      expect(list.length).toBeLessThanOrEqual(12);
    }
  });
});
