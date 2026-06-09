import { describe, it, expect, beforeAll } from 'vitest';
import { loadDictionaries, getCandidates, normalizePinyin } from '@/server/dictionary';

describe('dictionary', () => {
  beforeAll(() => {
    loadDictionaries();
  });

  it('loads the three dictionary files', () => {
    // No throw = success
    expect(true).toBe(true);
  });

  it('getCandidates returns sorted candidates for a known pinyin', () => {
    const cands = getCandidates('ni', false, 'simplified');
    expect(cands.length).toBeGreaterThan(0);
    expect(cands[0]?.char).toBeTruthy();
    // Sorted by freq desc
    for (let i = 1; i < cands.length; i++) {
      expect(cands[i - 1]!.freq).toBeGreaterThanOrEqual(cands[i]!.freq);
    }
  });

  it('getCandidates returns empty for unknown pinyin', () => {
    const cands = getCandidates('zzzzz', false, 'simplified');
    expect(cands).toEqual([]);
  });
});

describe('normalizePinyin', () => {
  it('strips diacritics', () => {
    expect(normalizePinyin('nǐ')).toBe('ni');
    expect(normalizePinyin('hǎo')).toBe('hao');
  });

  it('replaces ü with v', () => {
    expect(normalizePinyin('lǜ')).toBe('lv');
    expect(normalizePinyin('nǚ')).toBe('nv');
  });

  it('strips tone digits', () => {
    expect(normalizePinyin('ni3')).toBe('ni');
    expect(normalizePinyin('hao3')).toBe('hao');
  });

  it('handles mixed input', () => {
    expect(normalizePinyin('nǐ3')).toBe('ni');
    expect(normalizePinyin("xi'an")).toBe('xian');
  });
});

describe('getCandidates with normalization', () => {
  it('finds candidates via diacritic input', () => {
    const diacritic = getCandidates('nǐ', false, 'simplified');
    const base = getCandidates('ni', false, 'simplified');
    expect(diacritic.length).toBe(base.length);
    expect(diacritic.length).toBeGreaterThan(0);
  });

  it('finds candidates via tone-digit input', () => {
    const withTone = getCandidates('ni3', false, 'simplified');
    const base = getCandidates('ni', false, 'simplified');
    expect(withTone.length).toBe(base.length);
  });
});
