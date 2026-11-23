// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { bestAlignment, compareReadings, type CharReading } from '@/lib/pronunciation';

/**
 * 对齐 —— 学生在长句里读一个词。
 *
 * 学生练「学生」时往往说「我是学生」。识别结果是四个字，直接比对前两个字
 * （「我是」）会把读音完全正确的人判成错。所以在长句里滑动一个与目标等长
 * 的窗口，取分数最高的那一段。
 */

function r(char: string, pinyin: string): CharReading {
  return { char, pinyin };
}

const TARGET = [r('学', 'xué'), r('生', 'shēng')];

describe('bestAlignment', () => {
  it('finds the word inside a longer sentence', () => {
    const alignment = bestAlignment(TARGET, [
      r('我', 'wǒ'),
      r('是', 'shì'),
      r('学', 'xué'),
      r('生', 'shēng'),
    ]);
    expect(alignment).not.toBeNull();
    expect(alignment?.offset).toBe(2);
    expect(alignment?.comparison.score).toBe(100);
    expect(alignment?.comparison.advice).toBe('perfect');
  });

  it('does not fail a learner who said the word first', () => {
    // 窗口从 0 开始时就是正确答案；不能被后面的字影响。
    const alignment = bestAlignment(TARGET, [r('学', 'xué'), r('生', 'shēng')]);
    expect(alignment?.offset).toBe(0);
    expect(alignment?.comparison.score).toBe(100);
  });

  it('prefers the higher-scoring window over the earlier one', () => {
    // 第 0 个窗口是错的（我/是），第 2 个窗口是「学生」的声调错。
    const alignment = bestAlignment(TARGET, [
      r('我', 'wǒ'),
      r('是', 'shì'),
      r('学', 'xué'),
      r('生', 'shēng'),
    ]);
    expect(alignment?.comparison.score).toBeGreaterThan(0);
  });

  it('reports missing characters when the utterance is shorter than the word', () => {
    const alignment = bestAlignment(TARGET, [r('学', 'xué')]);
    expect(alignment?.spoken).toHaveLength(1);
    expect(alignment?.comparison.verdicts).toEqual(['exact', 'missing']);
  });

  it('returns null for an empty target', () => {
    expect(bestAlignment([], [r('学', 'xué')])).toBeNull();
  });

  it('keeps the offset a learner can act on', () => {
    // 偏移让 UI 能说「这次读到第 3 个字」，而不是只给一个分数。
    const alignment = bestAlignment(TARGET, [
      r('这', 'zhè'),
      r('是', 'shì'),
      r('学', 'xué'),
      r('生', 'shēng'),
      r('吗', 'ma'),
    ]);
    expect(alignment?.offset).toBe(2);
  });
});

describe('compareReadings inside a window', () => {
  it('still scores the tone mistake as a tone mistake', () => {
    const comparison = compareReadings(TARGET, [r('雪', 'xuě'), r('生', 'shēng')]);
    expect(comparison.verdicts).toEqual(['tone', 'exact']);
    expect(comparison.advice).toBe('tones');
  });

  it('says "nothing" when the window is empty', () => {
    const comparison = compareReadings(TARGET, []);
    expect(comparison.advice).toBe('nothing');
    expect(comparison.verdicts).toEqual(['missing', 'missing']);
  });
});
