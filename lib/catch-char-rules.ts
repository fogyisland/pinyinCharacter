/**
 * The rules of 听音接字 (catch-the-character) — the pure logic, with no
 * canvas, no React and no DOM.
 *
 * The game: a target character's READING is spoken (and its pinyin is
 * shown on the left). Three characters fall — the target plus two
 * distractors that sound like it. The player catches the right one; catching
 * a distractor or letting the target fall is a miss.
 *
 * WHY THE RULES LIVE HERE, SEPARATE FROM THE CANVAS
 * The canvas is where the pixels live, and pixels are hard to assert on.
 * Everything that decides whether the player was RIGHT lives here, so it
 * can be tested without a browser: how a wave is built, how similar two
 * characters sound, and whether a bubble landed in the basket.
 *
 * THE DISTRACTOR IS THE WHOLE GAME
 * A distractor that differs from the target in every way is trivial to
 * reject by sight — the player never has to listen. A distractor that
 * differs in only ONE dimension — the same syllable in another tone, or
 * the same initial in another final — is what forces the player to
 * actually hear the sound. So `similarityScore` rewards pairs that share
 * a syllable, then an initial, and the wave builder picks the closest
 * characters it can find.
 */

import { toneFromPinyin } from './pinyin-tone';

/** A character the game can drop. */
export interface CatchChar {
  /** The character itself, e.g. '妈'. */
  char: string;
  /** The reading with its tone mark, e.g. 'mā'. */
  pinyin: string;
  /** The tone, 1-4. Neutral readings are excluded from the pool upstream. */
  tone: 1 | 2 | 3 | 4;
  /** The Chinese gloss, shown after a catch. */
  meaning: string;
  /** The radical, shown after a catch. */
  radical: string;
}

/** How many characters one round asks the player to catch. */
export const CATCH_ROUND_CHARS = 10;

/**
 * How many distractors fall alongside the target.
 *
 * Three bubbles on the canvas: one to catch, two to reject. More than
 * three and the basket has no time to travel; fewer and the choice is
 * binary.
 */
export const CATCH_DISTRACTORS = 2;

/** The bubble's radius, in canvas px. */
export const CATCH_BUBBLE_RADIUS = 30;

/** How far apart two bubbles must start horizontally, in canvas px. */
export const CATCH_BUBBLE_MIN_GAP = 110;

/** The canvas width the layout is computed against, in canvas px. */
export const CATCH_CANVAS_WIDTH = 624;

/** The canvas height the layout is computed against, in canvas px. */
export const CATCH_CANVAS_HEIGHT = 604;

/** One bubble on the canvas. */
export interface CatchBubble {
  /** The character this bubble carries. */
  char: string;
  /** Whether this bubble is the one the player must catch. */
  isTarget: boolean;
  /** The horizontal centre, in canvas px. */
  x: number;
  /** The vertical centre, in canvas px. */
  y: number;
  /** The radius, in canvas px. */
  radius: number;
  /** The character's reading, with its tone mark. */
  pinyin: string;
  /** The character's tone. */
  tone: 1 | 2 | 3 | 4;
}

/** What the basket did with a bubble. */
export type CatchVerdictKind = 'hit' | 'wrong' | 'none';

/** The verdict on one bubble. */
export interface CatchVerdict {
  kind: CatchVerdictKind;
  /** Where the catch happened, so the particles can be spawned there. */
  x: number;
  /** Where the catch happened, so the particles can be spawned there. */
  y: number;
  /** The character that was caught (empty when nothing was caught). */
  char: string;
}

/**
 * The pinyin with its tone marks stripped and lower-cased.
 *
 * 'mā' → 'ma', 'zhōng' → 'zhong'. The tone mark lives on ONE vowel, so
 * the strip has to be diacritic-aware — a plain regex over a-z would
 * leave 'mā' as 'mā' and the two syllables would never compare equal.
 */
export function plainPinyin(pinyin: string): string {
  return pinyin
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ü/g, 'v')
    .toLowerCase();
}

/** The initial of a syllable: 'zhōng' → 'zh', 'mā' → 'm'. */
export function initialOf(pinyin: string): string {
  const plain = plainPinyin(pinyin);
  if (plain.startsWith('zh')) return 'zh';
  if (plain.startsWith('ch')) return 'ch';
  if (plain.startsWith('sh')) return 'sh';
  return plain.slice(0, 1);
}

/** The final of a syllable: 'zhōng' → 'ong', 'mā' → 'a'. */
export function finalOf(pinyin: string): string {
  const plain = plainPinyin(pinyin);
  const initial = initialOf(pinyin);
  // The initial is a prefix of the plain syllable, so slicing it off is
  // safe once the syllable is known to be non-empty (guarded below).
  return plain.length > initial.length ? plain.slice(initial.length) : '';
}

/**
 * How similar two characters SOUND, from 0 (nothing in common) up to 100.
 *
 * The scale, in descending order of how hard the pair is to tell apart:
 *
 *   100 — the same syllable AND the same tone ('mā' vs 'mā'): impossible
 *         to tell apart by ear, so a pair like this must never be used as
 *         a distractor.
 *    80 — the same syllable, a different tone ('mā' vs 'má'): the classic
 *         hard case. The player hears the right sound but must catch the
 *         right TONE.
 *    55 — a different syllable, the same initial AND the same final
 *         length ('mā' vs 'māo'): close enough to be confusing.
 *    30 — the same initial only ('mā' vs 'mào'): a weaker trap.
 *    10 — the same final only ('mā' vs 'hā'): a whisper of a resemblance.
 *     0 — nothing in common.
 *
 * The score is deliberately NOT additive across dimensions, because
 * additive scoring lets two weak matches beat one strong match — and a
 * same-initial-only pair is a much better distractor than two unrelated
 * ones.
 */
export function similarityScore(a: CatchChar, b: CatchChar): number {
  // A character against ITSELF is not a distractor — the wave would carry
  // two identical characters and the round would be unplayable. Score it
  // below every real distractor so the wave builder never picks it.
  if (a.char === b.char) return 0;

  const plainA = plainPinyin(a.pinyin);
  const plainB = plainPinyin(b.pinyin);
  if (!plainA || !plainB) return 0;

  if (plainA === plainB) {
    // The same syllable. The tone decides whether the pair is playable.
    return a.tone === b.tone ? 100 : 80;
  }

  const sameInitial = initialOf(a.pinyin) === initialOf(b.pinyin);
  const sameFinal = finalOf(a.pinyin) === finalOf(b.pinyin);

  if (sameInitial && sameFinal) return 55;
  if (sameInitial) return 30;
  if (sameFinal) return 10;
  return 0;
}

/**
 * A small, seeded random generator (mulberry32).
 *
 * The wave builder must be reproducible: a test that asserts "the
 * distractors are the most similar characters" cannot assert anything
 * about a wave built from `Math.random()`. The component passes a seed
 * per round; the same seed always builds the same wave.
 */
export function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return function next(): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Picks the two distractors that sound most like the target.
 *
 * The pool is scanned for the highest-scoring candidates; a candidate
 * that scores 0 (nothing in common) is only accepted when the pool holds
 * nothing better, so the wave still works on a thin pool.
 */
function pickDistractors(
  pool: readonly CatchChar[],
  target: CatchChar,
  count: number,
  rng: () => number,
): CatchChar[] {
  const candidates = pool.filter((c) => c.char !== target.char);
  if (candidates.length === 0) return [];

  const scored = candidates
    .map((c) => ({ item: c, score: similarityScore(target, c) }))
    // The score first, so the best distractors lead; the character as the
    // tie-break, so the order does not depend on the pool's order.
    .sort((x, y) => (y.score - x.score) || x.item.char.localeCompare(y.item.char));

  const chosen: CatchChar[] = [];
  for (const candidate of scored) {
    if (chosen.length >= count) break;
    chosen.push(candidate.item);
  }
  return chosen;
}

/**
 * Builds one wave: the target plus its distractors, spread across the
 * canvas.
 *
 * The bubbles start at different heights as well as different widths, so
 * the player cannot read the answer off the shape of the wave.
 */
export function buildWave(
  pool: readonly CatchChar[],
  target: CatchChar,
  seed: number,
  distractorsPerWave: number = CATCH_DISTRACTORS,
): CatchBubble[] {
  const rng = makeRng(seed);
  const picked = pickDistractors(pool, target, distractorsPerWave, rng);

  const bubbles: CatchBubble[] = [];
  const slots = picked.length + 1;

  // The bubbles are laid out in `slots` even columns across the canvas,
  // each in the middle of its column, and start at staggered heights.
  const columnWidth = CATCH_CANVAS_WIDTH / slots;
  const order = shuffle([target, ...picked], rng);

  order.forEach((item, index) => {
    const centre = columnWidth * (index + 0.5);
    // The height is jittered so two waves of the same characters do not
    // look identical, and staggered so the target is never always first.
    const jitter = Math.floor(rng() * 120);
    bubbles.push({
      char: item.char,
      isTarget: item.char === target.char,
      x: Math.round(centre),
      y: 60 + jitter,
      radius: CATCH_BUBBLE_RADIUS,
      pinyin: item.pinyin,
      tone: item.tone,
    });
  });

  return bubbles;
}

/** Shuffles a copy of the list with the given generator. */
function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = copy[i]!;
    copy[i] = copy[j]!;
    copy[j] = a;
  }
  return copy;
}

/**
 * Decides whether the basket caught a bubble.
 *
 * The basket is a rectangle: its centre, its half-width and its half-height.
 * A bubble is caught when its centre is inside the basket's mouth.
 *
 * `bubble` is the bubble as it is THIS FRAME — the caller passes the same
 * object that is being moved, so the test can place a bubble by hand.
 */
export function classifyCatch(
  bubble: Pick<CatchBubble, 'char' | 'isTarget' | 'x' | 'y' | 'radius'>,
  basketX: number,
  basketY: number,
  basketHalfWidth: number,
  basketHalfHeight: number,
): CatchVerdict {
  const withinX = Math.abs(bubble.x - basketX) <= basketHalfWidth + bubble.radius * 0.4;
  const withinY = Math.abs(bubble.y - basketY) <= basketHalfHeight + bubble.radius * 0.4;

  if (!withinX || !withinY) {
    return { kind: 'none', x: bubble.x, y: bubble.y, char: '' };
  }

  return {
    kind: bubble.isTarget ? 'hit' : 'wrong',
    x: bubble.x,
    y: bubble.y,
    char: bubble.char,
  };
}

/**
 * Picks the target of a round.
 *
 * A good target has AT LEAST ONE close neighbour in the pool — otherwise
 * the wave holds three unrelated characters and the round is a giveaway.
 * The search falls back to a random character when the pool is too thin to
 * offer one.
 */
export function pickTarget(
  pool: readonly CatchChar[],
  seed: number,
  minDistractors = 1,
): CatchChar | null {
  if (pool.length === 0) return null;
  const rng = makeRng(seed);

  const withNeighbour = pool.filter((c) =>
    pool.some((other) => other.char !== c.char && similarityScore(c, other) > 0),
  );
  const source = withNeighbour.length > 0 ? withNeighbour : pool;
  return source[Math.floor(rng() * source.length)] ?? null;
}

/**
 * Normalises a pool for the game: it drops the neutral readings (no tone
 * mark) and the duplicates.
 *
 * The pool arrives from /api/chain/chars, which already filters the
 * neutral readings, but the game must not depend on that filter having
 * been applied — a neutral reading has no tone to play, and `tone` would
 * be a lie.
 */
export function normalizePool(chars: readonly CatchChar[]): CatchChar[] {
  const seen = new Set<string>();
  const pool: CatchChar[] = [];
  for (const c of chars) {
    if (!c.char || seen.has(c.char)) continue;
    const tone = toneFromPinyin(c.pinyin);
    if (!tone) continue;
    seen.add(c.char);
    pool.push({ ...c, tone });
  }
  return pool;
}
