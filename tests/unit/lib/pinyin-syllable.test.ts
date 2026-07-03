import { describe, it, expect } from 'vitest';
import { getLastLetter, expandLastLetter } from '@/lib/pinyin-syllable';

describe('getLastLetter', () => {
  it('returns last letter for standard diacritic pinyin', () => {
    expect(getLastLetter('dēng')).toBe('g');
    expect(getLastLetter('shuāng')).toBe('g');
    expect(getLastLetter('hǎo')).toBe('o');
    expect(getLastLetter('ān')).toBe('n');
    expect(getLastLetter('é')).toBe('e');
  });

  it('strips numeric tone suffix', () => {
    expect(getLastLetter('deng1')).toBe('g');
    expect(getLastLetter('hao3')).toBe('o');
    expect(getLastLetter('an4')).toBe('n');
  });

  it('strips diaeresis (NFD normalizes ü to u)', () => {
    expect(getLastLetter('lǜ')).toBe('u');
    expect(getLastLetter('nǚ')).toBe('u');
  });

  it('handles v notation for ü', () => {
    expect(getLastLetter('nv4')).toBe('v');
    expect(getLastLetter('lv4')).toBe('v');
  });

  it('handles y- initial syllables (spelling last letter)', () => {
    expect(getLastLetter('yī')).toBe('i');
    expect(getLastLetter('ye4')).toBe('e');
    expect(getLastLetter('yue4')).toBe('e');
    expect(getLastLetter('yuan1')).toBe('n');
    expect(getLastLetter('yun4')).toBe('n');
    expect(getLastLetter('yin1')).toBe('n');
    expect(getLastLetter('ying1')).toBe('g');
  });

  it('returns empty for empty input', () => {
    expect(getLastLetter('')).toBe('');
  });
});

describe('expandLastLetter', () => {
  it('expands i to include y (holistic syllable wildcard)', () => {
    expect(expandLastLetter('i')).toEqual(['i', 'y']);
  });

  it('expands u to include w + ü-pairing initials', () => {
    expect(expandLastLetter('u')).toEqual(['u', 'w', 'y', 'j', 'q', 'x', 'l', 'n']);
  });

  it('expands v/ü to include ü-pairing initials', () => {
    expect(expandLastLetter('v')).toEqual(['v', 'ü', 'y', 'j', 'q', 'x', 'l', 'n']);
    expect(expandLastLetter('ü')).toEqual(['v', 'ü', 'y', 'j', 'q', 'x', 'l', 'n']);
  });

  it('returns single letter for non-wildcard', () => {
    expect(expandLastLetter('a')).toEqual(['a']);
    expect(expandLastLetter('b')).toEqual(['b']);
    expect(expandLastLetter('g')).toEqual(['g']);
    expect(expandLastLetter('n')).toEqual(['n']);
  });

  it('returns single letter for unknown (fallback)', () => {
    expect(expandLastLetter('z')).toEqual(['z']);
  });
});
