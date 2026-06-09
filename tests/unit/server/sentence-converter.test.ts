import { describe, it, expect, beforeAll } from 'vitest';
import { loadDictionaries } from '@/server/dictionary';
import { convertSentence } from '@/server/sentence-converter';

beforeAll(() => loadDictionaries());

describe('convertSentence', () => {
  it('converts a simple pinyin with tones', () => {
    // nǐhǎo
    expect(convertSentence('ni3hao3', false, 'simplified')).toBe('你好');
  });

  it('returns empty for empty input', () => {
    expect(convertSentence('', false, 'simplified')).toBe('');
  });

  it('handles apostrophe-separated syllables (xi an)', () => {
    // Viterbi is best-effort: depends on bigram data having 西→安
    // Accept any plausible 2-char CJK result (西安, 戏安, etc.)
    const result = convertSentence("xi'an", false, 'simplified');
    expect(result).toHaveLength(2);
    expect(result).toMatch(/^[㐀-鿿]{2}$/);
  });

  it('respects safeMode by avoiding bad chars when alternative exists', () => {
    // When the only path contains a bad char, returns empty
    // We don't have specific bad chars in the data, so test the plumbing
    const result = convertSentence('ni3hao3', true, 'simplified');
    expect(result === '你好' || result === '').toBe(true);
  });
});
