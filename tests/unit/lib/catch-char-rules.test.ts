// @vitest-environment happy-dom
/**
 * The rules of 听音接字 — the pure logic, with no canvas and no React.
 *
 * The game: a target character's READING is spoken (and its pinyin shown on
 * the left). Three characters fall — the target plus two distractors that
 * share a sound with it. The player catches the right one; catching a
 * distractor or letting the target fall is a miss.
 *
 * The hard part is the DISTRACTOR choice. A distractor that differs from the
 * target in every way is trivial to reject by sight. A distractor that
 * differs in only ONE dimension — same pinyin but different tone, or same
 * initial but different final — is what makes the game worth playing: the
 * player has to actually listen.
 *
 * So the rules module owns:
 *   ① how a wave is built (the target + two distractors)
 *   ② what makes a distractor a GOOD one (similarity scoring)
 *   ③ the collision test (did the basket catch this bubble?)
 *   ④ the round's verdict (catch / wrong catch / dropped)
 */
import { describe, it, expect } from 'vitest';

import {
  CATCH_CANVAS_HEIGHT,
  CATCH_CANVAS_WIDTH,
  CATCH_ROUND_CHARS,
  buildWave,
  classifyCatch,
  normalizePool,
  pickTarget,
  similarityScore,
  type CatchChar,
  type CatchVerdict,
} from '@/lib/catch-char-rules';

const ci = (char: string, pinyin: string, tone: 1 | 2 | 3 | 4 = 1): CatchChar => ({
  char,
  pinyin,
  tone,
  meaning: '',
  radical: '',
});

const POOL: CatchChar[] = [
  ci('妈', 'mā', 1),
  ci('麻', 'má', 2),
  ci('马', 'mǎ', 3),
  ci('码', 'mǎ', 3),
  ci('骂', 'mà', 4),
  ci('猫', 'māo', 1),
  ci('毛', 'máo', 2),
  ci('鸟', 'niǎo', 3),
  ci('鱼', 'yú', 2),
  ci('雨', 'yǔ', 3),
  ci('语', 'yǔ', 3),
];

describe('the similarity score', () => {
  it('is highest for two characters that share a syllable and a tone', () => {
    // 妈 mā and 麻 má differ ONLY in tone — the hardest pair to tell apart
    // by ear, so they must score higher than any other pair here.
    expect(similarityScore(ci('妈', 'mā', 1), ci('麻', 'má', 2))).toBeGreaterThan(
      similarityScore(ci('妈', 'mā', 1), ci('猫', 'māo', 1)),
    );
  });

  it('is higher for a same-initial pair than for an unrelated pair', () => {
    const sameInitial = similarityScore(ci('妈', 'mā', 1), ci('麻', 'má', 2));
    const unrelated = similarityScore(ci('妈', 'mā', 1), ci('鸟', 'niǎo', 3));
    expect(sameInitial).toBeGreaterThan(unrelated);
  });

  it('is 0 for two characters that share nothing', () => {
    expect(similarityScore(ci('妈', 'mā', 1), ci('鱼', 'yú', 2))).toBe(0);
  });

  it('never scores a character against itself as a good distractor', () => {
    // The target must not be able to pick ITSELF as a distractor — that
    // would put two identical characters on the sheet.
    const score = similarityScore(ci('妈', 'mā', 1), ci('妈', 'mā', 1));
    expect(score).toBeLessThan(similarityScore(ci('妈', 'mā', 1), ci('麻', 'má', 2)));
  });

  it('is symmetric', () => {
    const a = ci('妈', 'mā', 1);
    const b = ci('码', 'mǎ', 3);
    expect(similarityScore(a, b)).toBe(similarityScore(b, a));
  });
});

describe('the wave', () => {
  it('holds the target and two distractors', () => {
    const wave = buildWave(POOL, POOL[0]!, 0);
    expect(wave).toHaveLength(3);
    expect(wave.filter((item) => item.isTarget)).toHaveLength(1);
    expect(wave.filter((item) => !item.isTarget)).toHaveLength(2);
  });

  it('never repeats a character', () => {
    const wave = buildWave(POOL, POOL[0]!, 0);
    const chars = wave.map((item) => item.char);
    expect(new Set(chars).size).toBe(chars.length);
  });

  it('excludes the target from the distractor set', () => {
    const wave = buildWave(POOL, POOL[0]!, 0);
    const distractors = wave.filter((item) => !item.isTarget);
    expect(distractors.map((d) => d.char)).not.toContain('妈');
  });

  it('picks the most similar characters as the distractors', () => {
    // The target 妈 mā has 麻 má (same syllable, other tone), 马 mǎ (same
    // syllable, other tone) and 码 mǎ in the pool. The two distractors must
    // be the closest ones — not 鱼 yú, which shares nothing.
    const wave = buildWave(POOL, POOL[0]!, 0);
    const distractorChars = wave.filter((item) => !item.isTarget).map((item) => item.char);
    expect(distractorChars).not.toContain('鱼');
    expect(distractorChars).not.toContain('鸟');
  });

  it('degrades gracefully when the pool has too few characters', () => {
    // A pool of two can only produce one distractor. The wave must not
    // invent a character and must not throw.
    const tiny = [ci('妈', 'mā', 1), ci('麻', 'má', 2)];
    const wave = buildWave(tiny, tiny[0]!, 0);
    expect(wave).toHaveLength(2);
    expect(wave.filter((item) => item.isTarget)).toHaveLength(1);
  });

  it('degrades gracefully when the pool holds only the target', () => {
    const solo = [ci('妈', 'mā', 1)];
    const wave = buildWave(solo, solo[0]!, 0);
    expect(wave).toHaveLength(1);
    expect(wave[0]!.isTarget).toBe(true);
  });

  it('places the bubbles at different heights and does not stack them', () => {
    const wave = buildWave(POOL, POOL[0]!, 0);
    const xs = wave.map((item) => item.x);
    expect(new Set(xs).size).toBe(xs.length);
  });

  it('spreads the bubbles across the canvas, not into one column', () => {
    // The bubbles have to be far enough apart that the player can see
    // them at a glance AND so that the answer is not "the lowest one".
    // A layout that collapsed them into a single column would still give
    // distinct x values — so the spread has to be asserted against the
    // canvas width, not merely against each other.
    const wave = buildWave(POOL, POOL[0]!, 0);
    const xs = wave.map((item) => item.x);
    const spread = Math.max(...xs) - Math.min(...xs);
    expect(
      spread,
      `the bubbles span only ${spread}px of a ${CATCH_CANVAS_WIDTH}px canvas`,
    ).toBeGreaterThan(CATCH_CANVAS_WIDTH / 2);
  });

  it('keeps every bubble inside the canvas', () => {
    const wave = buildWave(POOL, POOL[0]!, 0);
    for (const bubble of wave) {
      expect(bubble.x - bubble.radius).toBeGreaterThanOrEqual(0);
      expect(bubble.x + bubble.radius).toBeLessThanOrEqual(CATCH_CANVAS_WIDTH);
      expect(bubble.y).toBeGreaterThan(0);
      expect(bubble.y).toBeLessThan(CATCH_CANVAS_HEIGHT);
    }
  });

  it('builds the same wave for the same seed', () => {
    // The wave must be reproducible, or a test could never assert
    // anything about it.
    const a = buildWave(POOL, POOL[0]!, 42);
    const b = buildWave(POOL, POOL[0]!, 42);
    expect(a).toEqual(b);
  });

  it('builds a different wave for a different seed', () => {
    const a = buildWave(POOL, POOL[0]!, 1);
    const b = buildWave(POOL, POOL[0]!, 999);
    expect(a).not.toEqual(b);
  });
});

describe('the catch', () => {
  // The basket sits near the BOTTOM of the canvas, so a caught bubble is
  // one that has fallen all the way down. These are the coordinates the
  // component uses.
  const BASKET_X = 300;
  const BASKET_Y = 540;
  const BASKET_HALF_WIDTH = 60;
  const BASKET_HALF_HEIGHT = 30;

  it('calls a catch of the target a hit', () => {
    const verdict = classifyCatch(
      {
        char: '妈',
        isTarget: true,
        x: BASKET_X,
        y: BASKET_Y,
        radius: 30,
      },
      BASKET_X,
      BASKET_Y,
      BASKET_HALF_WIDTH,
      BASKET_HALF_HEIGHT,
    );
    expect(verdict.kind).toBe('hit');
  });

  it('calls a catch of a distractor a wrong catch', () => {
    const verdict = classifyCatch(
      {
        char: '麻',
        isTarget: false,
        x: BASKET_X,
        y: BASKET_Y,
        radius: 30,
      },
      BASKET_X,
      BASKET_Y,
      BASKET_HALF_WIDTH,
      BASKET_HALF_HEIGHT,
    );
    expect(verdict.kind).toBe('wrong');
  });

  it('ignores a bubble that is still above the basket', () => {
    const verdict = classifyCatch(
      {
        char: '妈',
        isTarget: true,
        x: BASKET_X,
        y: 10,
        radius: 30,
      },
      BASKET_X,
      BASKET_Y,
      BASKET_HALF_WIDTH,
      BASKET_HALF_HEIGHT,
    );
    expect(verdict.kind).toBe('none');
  });

  it('ignores a bubble that passes beside the basket', () => {
    const verdict = classifyCatch(
      {
        char: '妈',
        isTarget: true,
        x: BASKET_X + 200,
        y: BASKET_Y,
        radius: 30,
      },
      BASKET_X,
      BASKET_Y,
      BASKET_HALF_WIDTH,
      BASKET_HALF_HEIGHT,
    );
    expect(verdict.kind).toBe('none');
  });

  it('reports the position of the catch, so the particles can be spawned', () => {
    const verdict = classifyCatch(
      {
        char: '妈',
        isTarget: true,
        x: BASKET_X,
        y: BASKET_Y,
        radius: 30,
      },
      BASKET_X,
      BASKET_Y,
      BASKET_HALF_WIDTH,
      BASKET_HALF_HEIGHT,
    );
    expect(verdict.x).toBe(BASKET_X);
    expect(verdict.y).toBe(BASKET_Y);
  });
});

describe('the round', () => {
  it('has a fixed number of characters', () => {
    expect(CATCH_ROUND_CHARS).toBeGreaterThan(0);
  });
});

describe('the pool', () => {
  it('drops the characters with a neutral reading', () => {
    // A neutral reading carries no tone mark, so there is no tone to
    // play and `tone` would be a lie. Such characters cannot be a target.
    const pool = normalizePool([
      ci('妈', 'mā', 1),
      ci('的', 'de', 1),
      ci('麻', 'má', 2),
    ]);
    expect(pool.map((c) => c.char)).toEqual(['妈', '麻']);
  });

  it('drops the duplicated characters', () => {
    const pool = normalizePool([ci('妈', 'mā', 1), ci('妈', 'mā', 1)]);
    expect(pool).toHaveLength(1);
  });

  it('reads the tone off the pinyin rather than trusting the caller', () => {
    // The caller may pass a wrong tone — the pinyin's own tone mark is
    // the source of truth.
    const pool = normalizePool([{ ...ci('妈', 'mā', 1), tone: 4 }]);
    expect(pool[0]!.tone).toBe(1);
  });

  it('keeps every character that carries a tone', () => {
    const pool = normalizePool([
      ci('妈', 'mā', 1),
      ci('麻', 'má', 2),
      ci('马', 'mǎ', 3),
      ci('骂', 'mà', 4),
    ]);
    expect(pool).toHaveLength(4);
  });
});

describe('the target', () => {
  it('is null for an empty pool', () => {
    expect(pickTarget([], 0)).toBeNull();
  });

  it('comes from the pool', () => {
    const target = pickTarget(POOL, 7);
    expect(target).not.toBeNull();
    expect(POOL.map((c) => c.char)).toContain(target!.char);
  });

  it('has a close neighbour, so the round is not a giveaway', () => {
    // A target whose only neighbours are unrelated characters would make
    // the wave trivial. Every target the game picks must have at least
    // one character in the pool that sounds like it.
    for (let seed = 0; seed < 20; seed++) {
      const target = pickTarget(POOL, seed);
      if (!target) continue;
      const hasNeighbour = POOL.some(
        (other) => other.char !== target.char && similarityScore(target, other) > 0,
      );
      expect(hasNeighbour, `the target ${target.char} has no similar neighbour`).toBe(true);
    }
  });

  it('is reproducible for a seed', () => {
    expect(pickTarget(POOL, 11)?.char).toBe(pickTarget(POOL, 11)?.char);
  });
});
