/**
 * 形近字 — look-alike characters, from the stroke data the site already
 * ships.
 *
 * ## The teaching problem
 *
 * Overseas learners lose most writing marks to look-alike characters, not
 * to unknown ones: 未/末 (which horizontal is longer), 己/已/巳 (how far the
 * vertical reaches), 土/士, 大/太/犬, 木/本/末, 干/千, 日/曰, 人/入.
 *
 * ## Why "similar overall" is the wrong question
 *
 * 大 and 太 are similar AND so are 木 and 林 — but only the first pair is a
 * confusion pair. The definition 形近字 uses is narrower:
 *
 *     same stroke count (±1), and MOST strokes coincide while EXACTLY ONE
 *     is measurably different.
 *
 * That is what this module measures:
 *
 *   `mean` — the average distance of the best stroke pairing, relative to
 *            the character's size. 未/末 = 0.035, 上/下 = 0.319.
 *   `max`  — the distance of the single most-different pair. 玉/王 = 0.010
 *            (the dot's offset), 上/下 = 0.738.
 *
 * A pair is 形近 when `mean <= 0.15` (most strokes agree) and
 * `max >= 0.015` (one stroke really differs). Both thresholds were chosen
 * from measurements, not taste: see `.tmp/probe-look-alike*.out`.
 *
 * ## Why the prefilter is normalised
 *
 * Comparing every pair of 3500 characters is 1.5 million stroke-matrix
 * computations (~11 minutes). A cheap signature — per stroke, its type and
 * its position bucket in the character's OWN normalised box — cuts that to
 * 0.4% of the pairs and runs in two seconds.
 *
 * The normalisation is the subtle part: 白/自 differ only by one stroke,
 * but 自 is taller, so an unsigned bucket puts the same strokes in different
 * cells and the pair is lost. Normalising to each character's own bounding
 * box fixes that.
 */

/** One stroke's median line, in the 1024-unit box. */
export type Stroke = number[][];

/** One look-alike found by the comparison. */
export interface LookAlike {
  /** The other character. */
  char: string;
  /** How well the shared strokes agree (relative to size). */
  mean: number;
  /** The single biggest stroke difference (relative to size). */
  max: number;
  /**
   * Which stroke of THIS character differs, 0-based, or -1 when the pairing
   * has no single standout. The UI highlights it — "这一笔不同".
   */
  diffStroke: number;
}

/** A comparison of two characters, for the detail page. */
export interface Comparison {
  a: string;
  b: string;
  mean: number;
  max: number;
  /** The differing stroke in `a`, or -1. */
  diffStrokeA: number;
  /** The differing stroke in `b`, or -1. */
  diffStrokeB: number;
  /** True when the pair passes the 形近 rule. */
  isLookAlike: boolean;
}

/**
 * A resolved look-alike view, computed on the server.
 *
 * ⚠️ Declared HERE, in the pure module, not in `lib/look-alike-data.ts`.
 * The panel that renders it is a client component, and a type import from a
 * module that reads files is still traced by the bundler — it broke
 * `next build` once already. Keeping the type next to the pure comparison
 * means the client never names the data module at all.
 */
export interface LookAlikeView {
  /** The pair to feature, or null when no shipped pair passes the live rule. */
  featured: {
    comparison: Comparison;
    strokeCountA: number;
    strokeCountB: number;
  } | null;
  /** The other look-alikes, as plain names. */
  rest: string[];
  /** How many look-alikes the table lists in total. */
  total: number;
}

/** Most strokes must coincide. */
export const MEAN_LIMIT = 0.15;

/** The one different stroke must be visible. */
export const MAX_LIMIT = 0.015;

/** Points sampled per stroke. */
const SAMPLE_COUNT = 8;

/** Buckets per axis in the signature (3 × 3). */
const BUCKETS = 3;

/** Signature entries two characters may differ in and still be compared. */
const SIGNATURE_GAP_LIMIT = 3;

/** How many look-alikes one character keeps. */
export const LOOK_ALIKE_CAP = 12;

/**
 * Sample a stroke at `count` points, evenly by arc length.
 *
 * Even arc length, not even index: a stroke bends, so index sampling
 * clusters points on the straight parts.
 */
export function sampleStroke(stroke: Stroke, count = SAMPLE_COUNT): number[][] {
  if (stroke.length === 0) return [];
  if (stroke.length === 1) return [[stroke[0][0], stroke[0][1]]];
  const segments: number[] = [];
  let total = 0;
  for (let i = 1; i < stroke.length; i += 1) {
    const length = Math.hypot(stroke[i][0] - stroke[i - 1][0], stroke[i][1] - stroke[i - 1][1]);
    segments.push(length);
    total += length;
  }
  if (total === 0) return [[stroke[0][0], stroke[0][1]]];
  const points: number[][] = [];
  let segment = 0;
  let accumulated = 0;
  for (let k = 0; k < count; k += 1) {
    const target = (total * k) / (count - 1);
    while (segment < segments.length - 1 && accumulated + segments[segment] < target) {
      accumulated += segments[segment];
      segment += 1;
    }
    const t = segments[segment] === 0 ? 0 : (target - accumulated) / segments[segment];
    points.push([
      stroke[segment][0] + (stroke[segment + 1][0] - stroke[segment][0]) * t,
      stroke[segment][1] + (stroke[segment + 1][1] - stroke[segment][1]) * t,
    ]);
  }
  return points;
}

/** The mean distance between two equal-length samples. */
export function meanDistance(a: number[][], b: number[][]): number {
  const count = Math.min(a.length, b.length);
  if (count === 0) return Infinity;
  let sum = 0;
  for (let i = 0; i < count; i += 1) {
    sum += Math.hypot(a[i][0] - b[i][0], a[i][1] - b[i][1]);
  }
  return sum / count;
}

/** The bounding box of a set of strokes. */
export function boxOf(strokes: Stroke[]): { width: number; height: number; size: number } {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const stroke of strokes) {
    for (const [x, y] of stroke) {
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  }
  if (!Number.isFinite(x0)) return { width: 1, height: 1, size: 1 };
  const width = Math.max(1, x1 - x0);
  const height = Math.max(1, y1 - y0);
  return { width, height, size: Math.max(width, height) };
}

/** The bounding box of one stroke. */
function strokeBox(stroke: Stroke): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of stroke) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1 };
}

/**
 * The cheap signature of a character: one entry per stroke, holding that
 * stroke's type and its position bucket INSIDE THE CHARACTER'S OWN box.
 */
export function signatureOf(strokes: Stroke[]): string[] {
  const outer = (() => {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const stroke of strokes) {
      for (const [x, y] of stroke) {
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
    }
    return { x0, y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
  })();

  const entries: string[] = [];
  for (const stroke of strokes) {
    const inner = strokeBox(stroke);
    const nx = ((inner.x0 + inner.x1) / 2 - outer.x0) / outer.w;
    const ny = ((inner.y0 + inner.y1) / 2 - outer.y0) / outer.h;
    const bucketX = Math.min(BUCKETS - 1, Math.max(0, Math.floor(nx * BUCKETS)));
    const bucketY = Math.min(BUCKETS - 1, Math.max(0, Math.floor(ny * BUCKETS)));
    entries.push(`${strokeKind(stroke, inner, outer.w, outer.h)}${bucketX}${bucketY}`);
  }
  return entries.sort();
}

/** The kind of a stroke, by relative size and direction. */
function strokeKind(
  stroke: Stroke,
  inner: { x0: number; y0: number; x1: number; y1: number },
  boxWidth: number,
  boxHeight: number,
): string {
  const maxDim = Math.max(inner.x1 - inner.x0, inner.y1 - inner.y0);
  // Relative, not absolute: a dot in a small glyph and a dot in a large one
  // must read the same, or two characters drawn at different sizes would
  // never compare.
  if (maxDim / Math.max(boxWidth, boxHeight) < 0.2) return 'd';
  const dx = stroke[stroke.length - 1][0] - stroke[0][0];
  const dy = stroke[stroke.length - 1][1] - stroke[0][1];
  const angle = (Math.atan2(Math.abs(dy), Math.abs(dx)) * 180) / Math.PI;
  if (angle <= 12) return 'h';
  if (angle >= 72) return dx < 0 ? 'p' : 's';
  return dx < 0 ? 'p' : 'n';
}

/** How many signature entries two characters do not share. */
export function signatureGap(a: string[], b: string[]): number {
  const counts = new Map<string, number>();
  for (const entry of a) counts.set(entry, (counts.get(entry) ?? 0) + 1);
  let shared = 0;
  for (const entry of b) {
    const remaining = counts.get(entry) ?? 0;
    if (remaining > 0) {
      shared += 1;
      counts.set(entry, remaining - 1);
    }
  }
  return Math.max(a.length, b.length) - shared;
}

/** A character prepared for comparison. */
export interface PreparedChar {
  char: string;
  /** Per-stroke samples. */
  samples: number[][][];
  /** max(bbox width, height). */
  size: number;
  /** The cheap prefilter signature. */
  signature: string[];
}

/**
 * Prepare one character for repeated comparison.
 *
 * @param char the character.
 * @param strokes its stroke medians.
 */
export function prepareChar(char: string, strokes: Stroke[]): PreparedChar {
  const { size } = boxOf(strokes);
  return {
    char,
    samples: strokes.map((stroke) => sampleStroke(stroke)),
    size,
    signature: signatureOf(strokes),
  };
}

/** The result of a full comparison. */
interface RawComparison {
  mean: number;
  max: number;
  /** Index in `a` of the most-different stroke (when the sizes allow it). */
  maxIndexA: number;
  /** Index in `b` of the most-different stroke. */
  maxIndexB: number;
}

/**
 * Greedy best pairing of two equal-or-neighbouring stroke sets.
 *
 * Greedy rather than optimal on purpose: the stroke counts are equal or one
 * apart, so the exact assignment differs from greedy only in ties, and the
 * comparison runs over millions of pairs in the build.
 */
function pairAll(a: PreparedChar, b: PreparedChar): RawComparison | null {
  const size = Math.max(a.size, b.size);
  const candidates: Array<{ ai: number; bi: number; distance: number }> = [];
  for (let i = 0; i < a.samples.length; i += 1) {
    for (let j = 0; j < b.samples.length; j += 1) {
      candidates.push({ ai: i, bi: j, distance: meanDistance(a.samples[i], b.samples[j]) });
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort((x, y) => x.distance - y.distance);
  const usedA = new Set<number>();
  const usedB = new Set<number>();
  let sum = 0;
  let count = 0;
  let maxDistance = 0;
  let maxIndexA = -1;
  let maxIndexB = -1;
  for (const entry of candidates) {
    if (usedA.has(entry.ai) || usedB.has(entry.bi)) continue;
    usedA.add(entry.ai);
    usedB.add(entry.bi);
    sum += entry.distance;
    count += 1;
    if (entry.distance > maxDistance) {
      maxDistance = entry.distance;
      maxIndexA = entry.ai;
      maxIndexB = entry.bi;
    }
  }
  return {
    mean: sum / count / size,
    max: maxDistance / size,
    maxIndexA,
    maxIndexB,
  };
}

/**
 * Compare two characters and judge whether they are 形近.
 *
 * @param a a prepared character.
 * @param b another prepared character.
 * @returns the comparison, or null when either has no strokes.
 */
export function compareChars(a: PreparedChar, b: PreparedChar): Comparison | null {
  if (a.samples.length === 0 || b.samples.length === 0) return null;
  if (Math.abs(a.samples.length - b.samples.length) > 1) return null;
  const raw = pairAll(a, b);
  if (!raw) return null;
  return {
    a: a.char,
    b: b.char,
    mean: raw.mean,
    max: raw.max,
    diffStrokeA: raw.maxIndexA,
    diffStrokeB: raw.maxIndexB,
    isLookAlike: raw.mean <= MEAN_LIMIT && raw.max >= MAX_LIMIT,
  };
}

/**
 * Every 形近字 of one character inside a corpus.
 *
 * The corpus is grouped by stroke count, and the signature prefilter drops
 * pairs that differ in more than two strokes before the expensive
 * comparison runs.
 *
 * @param target the character whose look-alikes are wanted.
 * @param corpus the characters to search, prepared.
 * @param cap how many look-alikes to return.
 * @returns the look-alikes, most similar first.
 */
export function findLookAlikes(
  target: PreparedChar,
  corpus: readonly PreparedChar[],
  cap = LOOK_ALIKE_CAP,
): LookAlike[] {
  const found: LookAlike[] = [];
  for (const other of corpus) {
    if (other.char === target.char) continue;
    if (signatureGap(target.signature, other.signature) > SIGNATURE_GAP_LIMIT) continue;
    const comparison = compareChars(target, other);
    if (!comparison?.isLookAlike) continue;
    found.push({
      char: other.char,
      mean: comparison.mean,
      max: comparison.max,
      diffStroke: comparison.diffStrokeA,
    });
  }
  found.sort((x, y) => x.mean - y.mean || x.char.localeCompare(y.char));
  return found.slice(0, cap);
}

/** The table the build produces: char → its look-alikes. */
export type LookAlikeTable = Record<string, LookAlike[]>;

/**
 * Build the whole table.
 *
 * One unordered pair is measured once and written into both directions, so
 * the table is symmetric by construction.
 *
 * @param corpus the characters, prepared.
 * @returns the table.
 */
export function buildLookAlikeTable(corpus: readonly PreparedChar[]): {
  table: LookAlikeTable;
  pairsMeasured: number;
  pairsConsidered: number;
} {
  const byStrokeCount = new Map<number, PreparedChar[]>();
  for (const entry of corpus) {
    const list = byStrokeCount.get(entry.samples.length) ?? [];
    list.push(entry);
    byStrokeCount.set(entry.samples.length, list);
  }

  // Both directions are collected FIRST and trimmed once at the end. Trimming
  // per direction while writing would let one side of a pair keep the other
  // while the other side dropped it — the table must be symmetric, or the
  // detail page says "未 looks like 末" while 末 never mentions 未.
  const pairs: Array<{ a: string; b: string; mean: number; max: number; diffA: number; diffB: number }> = [];
  let pairsConsidered = 0;
  let pairsMeasured = 0;

  for (const self of corpus) {
    for (const delta of [-1, 0, 1]) {
      const neighbours = byStrokeCount.get(self.samples.length + delta);
      if (!neighbours) continue;
      for (const other of neighbours) {
        // Each unordered pair once: the two directions are written together.
        if (other.char === self.char || other.char <= self.char) continue;
        pairsConsidered += 1;
        if (signatureGap(self.signature, other.signature) > SIGNATURE_GAP_LIMIT) continue;
        pairsMeasured += 1;
        const comparison = compareChars(self, other);
        if (!comparison?.isLookAlike) continue;
        pairs.push({
          a: self.char,
          b: other.char,
          mean: comparison.mean,
          max: comparison.max,
          diffA: comparison.diffStrokeA,
          diffB: comparison.diffStrokeB,
        });
      }
    }
  }

  // Rank every character's candidates globally, then keep the same top-N on
  // both sides of each surviving pair.
  const ranked = new Map<string, Array<{ other: string; mean: number; max: number; diff: number }>>();
  for (const pair of pairs) {
    (ranked.get(pair.a) ?? ranked.set(pair.a, []).get(pair.a)!).push({
      other: pair.b,
      mean: pair.mean,
      max: pair.max,
      diff: pair.diffA,
    });
    (ranked.get(pair.b) ?? ranked.set(pair.b, []).get(pair.b)!).push({
      other: pair.a,
      mean: pair.mean,
      max: pair.max,
      diff: pair.diffB,
    });
  }

  // Trim per character, THEN keep only pairs both sides kept.
  //
  // Trimming each side independently breaks symmetry: 十 can keep 未 in its
  // top 12 while 未's top 12 is too crowded to keep 十, and then the detail
  // page says 「十 looks like 未」 while 未 never mentions 十. A mutual
  // filter makes the table symmetric by construction.
  const trimmed = new Map<string, Array<{ other: string; mean: number; max: number; diff: number }>>();
  for (const [char, list] of ranked) {
    list.sort((x, y) => x.mean - y.mean || x.other.localeCompare(y.other));
    trimmed.set(char, list.slice(0, LOOK_ALIKE_CAP));
  }

  const table: LookAlikeTable = {};
  for (const [char, list] of trimmed) {
    const kept = list.filter((entry) => {
      const reverse = trimmed.get(entry.other);
      return reverse?.some((candidate) => candidate.other === char) ?? false;
    });
    if (kept.length === 0) continue;
    table[char] = kept.map((entry) => ({
      char: entry.other,
      mean: entry.mean,
      max: entry.max,
      diffStroke: entry.diff,
    }));
  }

  return { table, pairsMeasured, pairsConsidered };
}
