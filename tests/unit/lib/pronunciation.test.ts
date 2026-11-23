// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  compareReadings,
  initialOf,
  finalOf,
  plainSyllable,
  scoreOf,
  type CharReading,
} from '@/lib/pronunciation';

/**
 * 读音判定 —— 纯逻辑。
 *
 * 这一层回答的是「学生读的和目标字差在哪」。它不录音、不联网、不依赖
 * 浏览器：识别结果（文本）由调用方给，这里只做比对。
 *
 * 为什么声调单独一类：对外汉语最常见的问题不是「说错字」，而是「字对、
 * 调错」——「买」和「卖」、「问」和「文」。把这种错标成「说错了」会让
 * 学生以为整句话白读；标成「声调不对，再试试第几声」才是能改的反馈。
 */

function reading(char: string, pinyin: string): CharReading {
  return { char, pinyin };
}

describe('syllable dissection', () => {
  it('strips the tone mark', () => {
    expect(plainSyllable('mǎi')).toBe('mai');
    expect(plainSyllable('xué')).toBe('xue');
    expect(plainSyllable('lǜ')).toBe('lv');
    expect(plainSyllable('de')).toBe('de');
  });

  it('splits an initial and a final', () => {
    const { initial, final } = splitOf('zhōng');
    expect(initial).toBe('zh');
    expect(final).toBe('ong');
  });

  it('gives an empty initial to a zero-initial syllable', () => {
    expect(initialOf('ài')).toBe('');
    expect(finalOf('ài')).toBe('ai');
    expect(initialOf('ér')).toBe('');
  });

  it('treats y and w as initials so 学 and 雪 compare by their finals', () => {
    // 学 xué / 雪 xuě share the final ue; treating "x" as the initial makes
    // that visible, which is what a tone-only mistake needs.
    expect(initialOf('xué')).toBe('x');
    expect(finalOf('xué')).toBe('ue');
    expect(finalOf('xuě')).toBe('ue');
  });
});

/** Local helper: the pair, without exporting it from the module. */
function splitOf(syllable: string): { initial: string; final: string } {
  const plain = plainSyllable(syllable);
  const initial = initialOf(syllable);
  return { initial, final: plain.slice(initial.length) };
}

describe('compareReadings', () => {
  it('scores an exact repeat at 100', () => {
    const result = compareReadings(
      [reading('学', 'xué'), reading('生', 'shēng')],
      [reading('学', 'xué'), reading('生', 'shēng')],
    );
    expect(result.score).toBe(100);
    expect(result.verdicts).toEqual(['exact', 'exact']);
    expect(result.advice).toBe('perfect');
  });

  it('marks the same syllable with the wrong tone as a tone mistake', () => {
    // 「买」 mǎi read as 「卖」 mài: the learner said the right syllable with
    // the wrong tone — the single most common error in Chinese class.
    const result = compareReadings([reading('买', 'mǎi')], [reading('卖', 'mài')]);
    expect(result.verdicts).toEqual(['tone']);
    expect(result.score).toBe(70);
    expect(result.advice).toBe('tones');
  });

  it('marks a different syllable with the same final as a similar mistake', () => {
    // 学 xué vs 雪 xuě is a tone mistake; 学 vs 却 què is a different
    // syllable that still shares the final — closer than a random miss.
    const result = compareReadings([reading('学', 'xué')], [reading('却', 'què')]);
    expect(result.verdicts).toEqual(['similar']);
    expect(result.score).toBe(45);
  });

  it('marks an unrelated character as wrong', () => {
    const result = compareReadings([reading('学', 'xué')], [reading('天', 'tiān')]);
    expect(result.verdicts).toEqual(['wrong']);
    expect(result.score).toBe(0);
    expect(result.advice).toBe('sounds');
  });

  it('marks a missing character when the learner said fewer', () => {
    const result = compareReadings(
      [reading('学', 'xué'), reading('生', 'shēng')],
      [reading('学', 'xué')],
    );
    expect(result.verdicts).toEqual(['exact', 'missing']);
    // Half the word is missing, so the advice is "not the word", not "tones".
    expect(result.advice).toBe('sounds');
  });

  it('compares character by character even when the learner said more', () => {
    const result = compareReadings(
      [reading('学', 'xué')],
      [reading('学', 'xué'), reading('生', 'shēng')],
    );
    expect(result.verdicts).toEqual(['exact']);
    expect(result.score).toBe(100);
  });

  it('returns nothing-said when there is no speech at all', () => {
    const result = compareReadings([reading('学', 'xué')], []);
    expect(result.verdicts).toEqual(['missing']);
    expect(result.score).toBe(0);
    expect(result.advice).toBe('nothing');
  });

  it('accepts a learner who says the right character with a wrong tone', () => {
    // The recogniser returns the character it heard; 「学」 heard as 「雪」
    // means the syllables matched and only the tone differed.
    const result = compareReadings([reading('学', 'xué')], [reading('雪', 'xuě')]);
    expect(result.verdicts).toEqual(['tone']);
  });

  it('avoids guessing when the spoken reading has no tone mark', () => {
    // A recogniser that returns plain pinyin (no diacritics) cannot tell a
    // tone mistake from an exact match; the verdict falls back to the
    // character comparison rather than claiming a tone error it cannot see.
    const result = compareReadings([reading('买', 'mǎi')], [reading('买', 'mai')]);
    expect(result.verdicts).toEqual(['exact']);
  });
});

describe('scoreOf', () => {
  it('averages the per-character scores', () => {
    expect(scoreOf(['exact', 'tone'])).toBe(85);
    expect(scoreOf(['exact', 'wrong'])).toBe(50);
  });

  it('returns 0 for no characters at all', () => {
    expect(scoreOf([])).toBe(0);
  });
});
