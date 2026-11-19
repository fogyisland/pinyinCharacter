import { describe, it, expect } from 'vitest';
import {
  relate,
  strokeType,
  strokeTypes,
  parseStrokes,
  isOneStrokeApart,
  buildQuestion,
  type MagicRelation,
  type Stroke,
} from '@/lib/magic-char-rules';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Reads a character's real stroke data from the repo. */
function loadStrokes(char: string): Stroke[] {
  const raw = JSON.parse(
    readFileSync(join(process.cwd(), 'public', 'strokes', `${char}.json`), 'utf-8'),
  );
  return parseStrokes(raw);
}

describe('the magic-character rules', () => {
  describe('strokeType', () => {
    it('reads a horizontal from a left-to-right stroke', () => {
      expect(strokeType([[0, 0], [100, 2]])).toBe('横');
    });

    it('reads a vertical from a top-to-bottom stroke', () => {
      expect(strokeType([[50, 0], [52, 100]])).toBe('竖');
    });

    it('reads a dot from a very short stroke', () => {
      expect(strokeType([[10, 10], [14, 14]])).toBe('点');
    });

    it('reads a left-falling stroke from a down-and-left stroke', () => {
      expect(strokeType([[100, 0], [10, 120]])).toBe('撇');
    });

    /**
     * The dot's length threshold is what tells a 点 from a short 横.
     *
     * 「太」右下角那一笔只有一百来点长 —— 按字的大小算它很小，
     * 但它仍然是点：笔画类型不同，配对时的容差就不同，容差错了
     * 「太」和「犬」就配不上。
     *
     * 判「点」必须相对它所在的那个字 ——「太」的点有一百来个单位长，
     * 是全表里最大的点之一，而「火」里的点只有三十来个。同一笔在
     * 不同的字里可能是点、也可能是捺，所以类型是整个字一起算的。
     */
    it('reads the dot of 太 as a dot', () => {
      const types = strokeTypes(loadStrokes('太'));
      expect(types.filter((type) => type === '点')).toHaveLength(1);
    });

    it('reads the small horizontal of 一 as a horizontal, not a dot', () => {
      expect(strokeTypes(loadStrokes('一'))[0]).toBe('横');
    });

    /**
     * 一笔陡峭（角度接近竖）但往左下走的，是撇，不是竖。
     *
     * 角度判不出这两者：「自」的第一笔是撇，斜了 73.7 度；「白」
     * 的竖斜了 76.4 度 —— 只看角度，撇会被当成竖。
     *
     * 分开它们的是方向：竖是直着往下走（有时候还会微微往右偏），
     * 撇一定往左偏。所以凡是陡峭又往左走的，一律算撇。
     *
     * 笔画类型错了，配对就配不上：「白」和「自」只差一笔（那撇
     * 变成了竖），类型一错，这一对就认不出来。
     */
    it('reads a steep left-falling stroke as a 撇, not a 竖', () => {
      // 「自」的第一笔：斜 73.7 度，往左偏 60 个单位。
      expect(strokeTypes(loadStrokes('自'))[0]).toBe('撇');
    });

    it('reads a steep right-leaning stroke as a 竖', () => {
      // 「白」的第二笔：斜 76.4 度，往右偏 108 个单位。
      expect(strokeTypes(loadStrokes('白'))[1]).toBe('竖');
    });

    /**
     * 「点」的长度门槛落在语料的一条真实边界上。
     *
     * 全表里按绝对长度判的点，最长的一笔是 89 个单位；最短的非点是
     * 90 个。所以 90 这个门槛不是调出来的数字，是语料的分界。
     *
     * 门槛一错，点就会被当成别的笔画，配对随即失败 —— 这一对要钉住。
     */
    it('reads a stroke of 89 units as a dot and one of 90 as not', () => {
      // 横着的一笔，长 89 —— 是点。
      expect(strokeType([[0, 0], [89, 0]])).toBe('点');
      // 横着的一笔，长 90 —— 不是点（角度是横，但长度过了门槛）。
      expect(strokeType([[0, 0], [90, 0]])).not.toBe('点');
    });
  });

  describe('relate', () => {
    it('finds that 太 is 大 plus one stroke', () => {
      expect(relate(loadStrokes('大'), loadStrokes('太'))).toBe('add');
    });

    it('finds that 犬 is 大 plus one stroke', () => {
      expect(relate(loadStrokes('大'), loadStrokes('犬'))).toBe('add');
    });

    it('finds that 天 is 大 plus one stroke', () => {
      expect(relate(loadStrokes('大'), loadStrokes('天'))).toBe('add');
    });

    it('finds that 夫 is 大 plus one stroke', () => {
      expect(relate(loadStrokes('大'), loadStrokes('夫'))).toBe('add');
    });

    it('finds that 大 is 天 minus one stroke', () => {
      expect(relate(loadStrokes('天'), loadStrokes('大'))).toBe('remove');
    });

    it('finds that 木 and 本 are one stroke apart', () => {
      expect(relate(loadStrokes('木'), loadStrokes('本'))).toBe('add');
      expect(relate(loadStrokes('本'), loadStrokes('木'))).toBe('remove');
    });

    it('finds that 太 and 犬 differ by one changed stroke', () => {
      // 太's dot moved; the two characters have the same stroke count, so
      // the relation can only be 'modify'.
      expect(relate(loadStrokes('太'), loadStrokes('犬'))).toBe('modify');
    });

    it('finds that 本 and 末 differ by one changed stroke', () => {
      expect(relate(loadStrokes('本'), loadStrokes('末'))).toBe('modify');
    });

    it('finds that 干 and 千 differ by one changed stroke', () => {
      expect(relate(loadStrokes('干'), loadStrokes('千'))).toBe('modify');
    });

    it('finds nothing between characters that are far apart', () => {
      expect(relate(loadStrokes('大'), loadStrokes('水'))).toBeNull();
      expect(relate(loadStrokes('木'), loadStrokes('林'))).toBeNull();
    });

    it('finds nothing when the stroke counts differ by more than one', () => {
      expect(relate(loadStrokes('一'), loadStrokes('中'))).toBeNull();
    });

    /**
     * 一 → 二 is the classic "add one stroke" pair, and it is the reason
     * the shared part is measured in two ways.
     *
     * 一's only horizontal sits in the middle of 一's own box, while 二's
     * two horizontals sit at the top and bottom of 二's box — so the
     * shared stroke's absolute POSITION differs. What did NOT change is
     * its shape: it merely slid down. A rule that only measured position
     * would miss this pair.
     */
    it('finds that 一 is 二 minus one stroke', () => {
      expect(relate(loadStrokes('一'), loadStrokes('二'))).toBe('add');
      expect(relate(loadStrokes('二'), loadStrokes('一'))).toBe('remove');
    });

    it('finds that 口 is 日 minus one stroke', () => {
      expect(relate(loadStrokes('口'), loadStrokes('日'))).toBe('add');
    });

    /**
     * The changed stroke may not travel to the other side of the
     * character and still count as the same stroke.
     *
     * 「木」的横变成了「水」的捺 —— 那不是「改一笔」，是换了一笔。
     */
    it('does not claim that 木 changed one stroke into 水', () => {
      expect(relate(loadStrokes('木'), loadStrokes('水'))).toBeNull();
    });

    /**
     * A stroke that changed SHAPE may not travel far either.
     *
     * 「干」的横变成「千」的撇，那一笔是改了形状但没有走远 —— 所以
     * 这一对是「改一笔」。
     */
    it('finds that 干 changed a horizontal into a 撇', () => {
      const 干 = loadStrokes('干');
      const 千 = loadStrokes('千');
      // The first stroke of 干 is the top horizontal; the first stroke of
      // 千 is the 撇 that took its place.
      expect(strokeType(干[0])).toBe('横');
      expect(strokeType(千[0])).toBe('撇');
    });
  });

  describe('isOneStrokeApart', () => {
    it('is true for the four characters one stroke from 大', () => {
      for (const char of ['太', '犬', '天', '夫']) {
        expect(isOneStrokeApart(loadStrokes('大'), loadStrokes(char))).toBe(true);
      }
    });

    it('is false for a character that is not one stroke away', () => {
      expect(isOneStrokeApart(loadStrokes('大'), loadStrokes('水'))).toBe(false);
    });

    it('is symmetric', () => {
      expect(isOneStrokeApart(loadStrokes('太'), loadStrokes('大'))).toBe(true);
    });
  });

  describe('parseStrokes', () => {
    it('reads the medians of a character', () => {
      const strokes = parseStrokes({ medians: [[[0, 0], [10, 10]]] });
      expect(strokes).toEqual([[[0, 0], [10, 10]]]);
    });

    it('gives up on data that is not an array of strokes', () => {
      expect(parseStrokes({ medians: 'not an array' })).toEqual([]);
      expect(parseStrokes({ medians: null })).toEqual([]);
      expect(parseStrokes({ medians: undefined })).toEqual([]);
    });

    it('gives up on a stroke that is not a list of points', () => {
      expect(parseStrokes({ medians: [[[0, 0], 'nope']] })).toEqual([]);
      expect(parseStrokes({ medians: [[]] })).toEqual([]);
      expect(parseStrokes({ medians: [[[0, 0], [NaN, 10]]] })).toEqual([]);
    });
  });

  /**
   * These pairs are the ones that separate the rule's two measures from
   * each other. Every one of them is a pair a human would NOT call "one
   * stroke apart" — so the rule must say null for all of them, and it
   * must be the MEASURE (not some later coincidence) that says so.
   *
   * They were found by mutating the rule and looking at which pairs
   * changed their answer:
   *
   *   - the shape measure disabled  → 开/生, 冉/伟, 生/自, 电/团, 伸/峄
   *   - the position measure disabled → 了/又, 力/又, 与/亍, 丸/义,
   *                                    廿/毛, 凹/卟, 包/卮, 召/四
   *   - the anchor bound removed     → 丈/亍, 乞/亿, 乏/今, 仄/火,
   *                                    切/讥, 升/片, 反/火, 少/贝,
   *                                    付/厉, 另/尼, 吝/含
   */
  describe('the measures that keep wrong pairs out', () => {
    it('rejects the pairs that only the shape measure rejects', () => {
      const pairs: Array<[string, string]> = [
        ['开', '生'], ['冉', '伟'], ['生', '自'], ['电', '团'], ['伸', '峄'],
      ];
      for (const [a, b] of pairs) {
        expect(relate(loadStrokes(a), loadStrokes(b))).toBeNull();
      }
    });

    it('rejects the pairs that only the position measure rejects', () => {
      const pairs: Array<[string, string]> = [
        ['了', '又'], ['力', '又'], ['与', '亍'], ['丸', '义'], ['廿', '毛'],
        ['凹', '卟'], ['包', '卮'], ['召', '四'],
      ];
      for (const [a, b] of pairs) {
        expect(relate(loadStrokes(a), loadStrokes(b))).toBeNull();
      }
    });

    it('rejects the pairs that only the anchor bound rejects', () => {
      const pairs: Array<[string, string]> = [
        ['丈', '亍'], ['乞', '亿'], ['乏', '今'], ['仄', '火'], ['切', '讥'],
        ['升', '片'], ['反', '火'], ['少', '贝'], ['付', '厉'], ['另', '尼'],
        ['吝', '含'],
      ];
      for (const [a, b] of pairs) {
        expect(relate(loadStrokes(a), loadStrokes(b))).toBeNull();
      }
    });
  });
});

describe('buildQuestion', () => {
  const table: Record<string, Record<string, MagicRelation>> = {
    大: { 太: 'add', 犬: 'add', 天: 'add', 夫: 'add' },
    木: { 本: 'add', 末: 'add', 未: 'add' },
    水: { 永: 'add' },
    日: { 曰: 'modify' },
  };

  it('returns null when the pool has no base with neighbours', () => {
    expect(buildQuestion(table, ['山'], 1)).toBeNull();
  });

  it('returns null when the pool is empty', () => {
    expect(buildQuestion(table, [], 1)).toBeNull();
  });

  it('picks a base that has at least one neighbour', () => {
    const question = buildQuestion(table, ['山', '木'], 1);
    expect(question?.base).toBe('木');
  });

  it('offers the answer among the options', () => {
    const question = buildQuestion(table, ['大', '木'], 1);
    expect(question).toBeTruthy();
    expect(question?.options).toContain(question?.answer);
  });

  it('offers four options in total', () => {
    const question = buildQuestion(table, ['大', '木', '水', '日'], 1);
    expect(question?.options).toHaveLength(4);
  });

  it('fills the options with characters that are NOT one stroke away', () => {
    const question = buildQuestion(table, ['大', '木', '水', '日'], 1);
    const wrong = question?.options.filter((c) => c !== question.answer) ?? [];
    for (const char of wrong) {
      expect(table[question!.base]?.[char]).toBeUndefined();
    }
  });

  it('does not repeat a character in the options', () => {
    const question = buildQuestion(table, ['大', '木', '水', '日'], 1);
    expect(new Set(question?.options).size).toBe(4);
  });

  it('is reproducible from its seed', () => {
    const a = buildQuestion(table, ['大', '木', '水', '日'], 7);
    const b = buildQuestion(table, ['大', '木', '水', '日'], 7);
    expect(a).toEqual(b);
  });

  it('gives a different question for a different seed', () => {
    const answers = new Set(
      [1, 2, 3, 4, 5, 6, 7, 8].map((s) => buildQuestion(table, ['大', '木', '水', '日'], s)?.answer),
    );
    expect(answers.size).toBeGreaterThan(1);
  });

  it('always leaves exactly one correct answer among the options', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const question = buildQuestion(table, ['大', '木', '水', '日'], seed);
      const correct = question?.options.filter((c) => table[question!.base]?.[c] !== undefined);
      expect(correct).toHaveLength(1);
    }
  });
});

/**
 * The three behaviours the plan's own tests left unpinned.
 *
 * The plan's ten tests pass on a builder that never shuffles the options,
 * that offers a valid neighbour as a wrong answer, and that lets the
 * top-up hand out neighbours. Each of those was caught by mutation — the
 * mutant survived the plan's tests — so each needs a test of its own.
 */
describe('buildQuestion, the behaviours the first ten tests left open', () => {
  /**
   * A table shaped like the real one.
   *
   * The builder writes a relation in BOTH directions, so every character
   * that has a relation is a base in its own right. 「太」is one stroke
   * from 「大」, so the real table has a 「太」entry — and that is the
   * entry the top-up could wrongly reach for.
   *
   * The plan's table leaves those entries out, which is why the mutants
   * below survive there.
   */
  const table: Record<string, Record<string, MagicRelation>> = {
    大: { 太: 'add', 犬: 'add', 天: 'add', 夫: 'add' },
    太: { 大: 'remove', 犬: 'modify', 夫: 'modify' },
    犬: { 大: 'remove', 太: 'modify', 天: 'modify' },
    天: { 大: 'remove', 夫: 'modify', 犬: 'modify' },
    夫: { 大: 'remove', 天: 'modify', 太: 'modify' },
    木: { 本: 'add', 末: 'add', 未: 'add' },
    本: { 木: 'remove', 末: 'modify', 未: 'modify' },
    末: { 木: 'remove', 本: 'modify', 未: 'modify' },
    未: { 木: 'remove', 本: 'modify', 末: 'modify' },
    水: { 永: 'add' },
    永: { 水: 'remove' },
    日: { 曰: 'modify' },
    曰: { 日: 'modify' },
  };

  /**
   * The answer must not always sit in the same place.
   *
   * If the options were never shuffled the answer would sit first every
   * time, and a player could learn "pick the first button" instead of
   * learning the rule. The position has to move.
   */
  it('moves the answer around the options', () => {
    const positions = new Set<number>();
    for (let seed = 1; seed <= 40; seed++) {
      const question = buildQuestion(table, ['大', '木', '水', '日'], seed);
      if (!question) continue;
      positions.add(question.options.indexOf(question.answer));
    }
    expect(positions.size).toBeGreaterThan(1);
  });

  /**
   * A character that IS one stroke away must never be offered as a wrong
   * answer.
   *
   * 「太」is one stroke from 「大」 — so a question whose base is 「大」
   * must never put 「太」among the wrong options: the player would count
   * two right answers. The test pools the base together with its own
   * neighbour, which is exactly the case where a careless builder would
   * offer that neighbour as a distractor.
   */
  it('never offers a valid neighbour as a wrong answer', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const question = buildQuestion(table, ['大', '太', '木', '水', '日'], seed);
      if (!question) continue;
      const wrong = question.options.filter((char) => char !== question.answer);
      for (const char of wrong) {
        expect(table[question.base]?.[char]).toBeUndefined();
      }
    }
  });

  /**
   * The same rule for the characters that fill the options up.
   *
   * When the pool is too small to supply three wrong answers, the builder
   * tops them up from the characters the table knows about. Those topped-
   * up characters must also be no relation to the base — otherwise the
   * question ends up with two right answers in it.
   */
  it('tops the options up with characters that are no relation to the base', () => {
    // A pool of two cannot supply three wrong answers, so the third has
    // to come from the top-up.
    //
    // 「太」is a neighbour of 「大」and it is in the pool — so the top-up
    // must not reach for it. The seeds sweep is what finds the case: the
    // answer is drawn from the base's neighbours, and when the draw
    // picks a neighbour OTHER than 「太」, the top-up has 「太」in reach.
    for (let seed = 1; seed <= 40; seed++) {
      const question = buildQuestion(table, ['大', '太'], seed);
      if (!question) continue;
      const wrong = question.options.filter((char) => char !== question.answer);
      expect(wrong).toHaveLength(3);
      for (const char of wrong) {
        expect(table[question.base]?.[char]).toBeUndefined();
      }
    }
  });
});
