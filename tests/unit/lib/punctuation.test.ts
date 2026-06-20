import { describe, it, expect } from 'vitest';
import { isPunct, buildBreakpoints, stripPunct } from '@/lib/punctuation';
import type { ClassicChunk } from '@/lib/classics-types';

describe('isPunct', () => {
  it.each([
    "。", "，", "！", "？", "；", "：", "、",
    "“", "”", "‘", "’", "「", "」", "（", "）", "(", ")", "…", "—",
  ])('returns true for %s', (ch) => {
    expect(isPunct(ch)).toBe(true);
  });
  it.each(['字', 'A', '1', ' '])('returns false for %s', (ch) => {
    expect(isPunct(ch)).toBe(false);
  });
  it('returns false for empty string', () => {
    expect(isPunct('')).toBe(false);
  });
});

describe('stripPunct', () => {
  it('removes all CJK punctuation', () => {
    expect(stripPunct('子曰：学而时习之。')).toBe('子曰学而时习之');
  });
  it('returns empty string for all-punct input', () => {
    expect(stripPunct('。！？')).toBe('');
  });
  it('returns input unchanged when no punct', () => {
    expect(stripPunct('学而')).toBe('学而');
  });
});

describe('buildBreakpoints', () => {
  const chunk: ClassicChunk = {
    id: 1,
    label: 'test',
    // 学而时习之。不亦说乎。有朋自远方来。
    content: ['学而时习之。不亦说乎。', '有朋自远方来。'],
    pinyin: [],
  };
  // 6 non-punct chars: 学 而 时 习 之 不 → 0..5
  // breakpoint BEFORE "不" (index 5) because prior char was "。"
  it('marks cell index after each 。！？ as a breakpoint', () => {
    const set = buildBreakpoints(chunk);
    expect(set.has(5)).toBe(true);
    // no breakpoint at index 0 (no preceding sentence)
    expect(set.has(0)).toBe(false);
  });

  it('handles ！ and ？ as sentence boundaries too', () => {
    const c: ClassicChunk = { id: 1, label: 't', content: ['善哉！善哉？再问。'], pinyin: [] };
    const set = buildBreakpoints(c);
    // 6 chars: 善 哉 善 哉 再 问 → indices 0..5
    // breakpoint before char at index 2 (after ！)
    // breakpoint before char at index 4 (after ？)
    // no breakpoint before char at index 5 (no char follows last 。)
    expect(set.has(2)).toBe(true);
    expect(set.has(4)).toBe(true);
    expect(set.has(5)).toBe(false);
  });

  it('returns empty set when chunk has no sentence-ending punctuation', () => {
    const c: ClassicChunk = { id: 1, label: 't', content: ['子曰学而'], pinyin: [] };
    expect(buildBreakpoints(c).size).toBe(0);
  });
});