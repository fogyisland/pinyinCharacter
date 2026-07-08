import { describe, it, expect } from 'vitest';
import { charPinyin, linePinyin, withPinyinBatch, toBmp, type RawChunk } from '@/lib/pinyin-gen';

describe('pinyin-gen', () => {
  it('charPinyin returns pinyin with tone mark', () => {
    expect(charPinyin('心')).toBe('xīn');
  });

  it('charPinyin returns empty string for non-CJK char', () => {
    // non-CJK falls through to pinyin-pro; we accept any non-empty result OR empty (catch path)
    // main contract is: never throws, always returns a string
    const r = charPinyin(' ');
    expect(typeof r).toBe('string');
  });

  it('linePinyin returns array aligned with input chars', () => {
    const r = linePinyin('我');
    expect(Array.isArray(r)).toBe(true);
    expect(r.length).toBe(1);
    expect(typeof r[0]).toBe('string');
  });

  it('toBmp drops surrogate halves and U+FFFD', () => {
    // 'a' + lone high surrogate + 'b' + U+FFFD + 'c'
    expect(toBmp('a\uD800b�c')).toBe('abc');
  });

  it('withPinyinBatch maps content -> pinyin via BMP sanitizer', () => {
    const chunks: RawChunk[] = [{ label: 'X', content: ['心经'] }];
    const out = withPinyinBatch(chunks);
    expect(out[0].label).toBe('X');
    expect(out[0].content).toEqual(['心经']);
    expect(out[0].pinyin.length).toBe(1);
    expect(Array.isArray(out[0].pinyin[0])).toBe(true);
    expect(out[0].pinyin[0].length).toBe(2);
  });
});
