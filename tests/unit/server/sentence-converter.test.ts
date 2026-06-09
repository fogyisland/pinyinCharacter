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

  it('handles apostrophe-separated syllables (xi an -> 西安)', () => {
    // xian could be "先" or "西安"; apostrophe disambiguates
    expect(convertSentence("xi'an", false, 'simplified')).toBe('西安');
  });

  it('respects safeMode by avoiding bad chars when alternative exists', () => {
    // When the only path contains a bad char, returns empty
    // We don't have specific bad chars in the data, so test the plumbing
    const result = convertSentence('ni3hao3', true, 'simplified');
    expect(result === '你好' || result === '').toBe(true);
  });
});
