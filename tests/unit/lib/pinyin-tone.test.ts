import { describe, it, expect } from 'vitest';
import { toneFromPinyin } from '@/lib/pinyin-tone';

describe('toneFromPinyin', () => {
  it('returns 1 for ā', () => {
    expect(toneFromPinyin('mā')).toBe(1);
  });
  it('returns 2 for á', () => {
    expect(toneFromPinyin('má')).toBe(2);
  });
  it('returns 3 for ǎ', () => {
    expect(toneFromPinyin('mǎ')).toBe(3);
  });
  it('returns 4 for à', () => {
    expect(toneFromPinyin('mà')).toBe(4);
  });
  it('returns 5 for unmarked syllable', () => {
    expect(toneFromPinyin('ma')).toBe(5);
    expect(toneFromPinyin('a')).toBe(5);
  });
  it('handles compound syllables (ni3hao3 with diacritics)', () => {
    expect(toneFromPinyin('nǐ')).toBe(3);
    expect(toneFromPinyin('hǎo')).toBe(3);
  });
  it('handles ü with tone mark (lǜ → 4)', () => {
    expect(toneFromPinyin('lǜ')).toBe(4);
  });
  it('returns 5 for empty string', () => {
    expect(toneFromPinyin('')).toBe(5);
  });
  it('returns 5 for v (ü placeholder) with no mark', () => {
    expect(toneFromPinyin('lv')).toBe(5);
  });
});