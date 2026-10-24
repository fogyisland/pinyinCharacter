import { describe, it, expect } from 'vitest';
import { baseLetter, readingSortKey, resolvePinyin, stripTone } from '@/lib/pinyin-index';

describe('baseLetter', () => {
  it('files a plain initial under its own letter', () => {
    expect(baseLetter('qī')).toBe('Q');
    expect(baseLetter('ma')).toBe('M');
  });

  it('files a zero-initial reading under its vowel', () => {
    expect(baseLetter('ā')).toBe('A');
    expect(baseLetter('ē')).toBe('E');
    expect(baseLetter('ō')).toBe('O');
  });

  it('files a genuinely ü-initial reading under V, per the Hanyu Pinyin alphabet', () => {
    expect(baseLetter('ǜ')).toBe('V');
  });

  it('files lü / nü under their own initial, not under V', () => {
    // ü only ever follows l/n/j/q/x/y in Mandarin, so lǜ belongs under L.
    expect(baseLetter('lǜ')).toBe('L');
    expect(baseLetter('nǚ')).toBe('N');
  });

  it('returns an empty string for an empty reading', () => {
    expect(baseLetter('')).toBe('');
  });
});

describe('stripTone', () => {
  it('removes the tone mark', () => {
    expect(stripTone('qī')).toBe('qi');
    expect(stripTone('hǎo')).toBe('hao');
  });

  it('maps ü to u so the sort key stays ASCII', () => {
    expect(stripTone('lǜ')).toBe('lu');
  });

  it('leaves a toneless reading untouched', () => {
    expect(stripTone('ma')).toBe('ma');
  });
});

describe('readingSortKey', () => {
  it('sorts by base syllable first, then by tone', () => {
    const readings = ['hǎo', 'hāo', 'háo', 'hào', 'hā'];
    const sorted = [...readings].sort((a, b) =>
      readingSortKey(a) < readingSortKey(b) ? -1 : 1,
    );
    // "ha" (hā) is a prefix of "hao", so it comes first — then the four tones.
    expect(sorted).toEqual(['hā', 'hāo', 'háo', 'hǎo', 'hào']);
  });

  it('sorts a neutral reading after the four tones', () => {
    expect(readingSortKey('ma') > readingSortKey('mà')).toBe(true);
  });
});

describe('resolvePinyin', () => {
  it('prefers the DB value when it is present', () => {
    expect(resolvePinyin('七', 'qī')).toBe('qī');
    expect(resolvePinyin('七', '  qī  ')).toBe('qī');
  });

  it('falls back to pinyin-pro when the DB value is empty', () => {
    expect(resolvePinyin('七', '')).toBe('qī');
    expect(resolvePinyin('七', null)).toBe('qī');
    expect(resolvePinyin('七', undefined)).toBe('qī');
  });
});
