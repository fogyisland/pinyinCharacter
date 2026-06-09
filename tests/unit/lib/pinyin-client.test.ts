import { describe, it, expect } from 'vitest';
import { textToPinyin, renderWithSpaces, renderWithoutSpaces } from '@/lib/pinyin-client';

describe('textToPinyin', () => {
  it('returns one token per char with tone marks', () => {
    const tokens = textToPinyin('你好');
    expect(tokens).toHaveLength(2);
    expect(tokens[0]?.char).toBe('你');
    expect(tokens[0]?.readings[0]).toBe('nǐ');
    expect(tokens[1]?.char).toBe('好');
    expect(tokens[1]?.readings[0]).toBe('hǎo');
  });

  it('includes all readings for polyphone', () => {
    // 行 is xíng or háng
    const tokens = textToPinyin('行');
    expect(tokens[0]?.readings.length).toBeGreaterThan(1);
    expect(tokens[0]?.readings).toContain('xíng');
    expect(tokens[0]?.readings).toContain('háng');
  });

  it('preserves non-Chinese chars as single-char tokens', () => {
    const tokens = textToPinyin('a');
    expect(tokens[0]?.char).toBe('a');
  });
});

describe('renderWithSpaces', () => {
  it('joins readings with space', () => {
    const tokens = textToPinyin('你好');
    expect(renderWithSpaces(tokens)).toBe('nǐ hǎo');
  });
});

describe('renderWithoutSpaces', () => {
  it('joins readings without space', () => {
    const tokens = textToPinyin('你好');
    expect(renderWithoutSpaces(tokens)).toBe('nǐhǎo');
  });
});
