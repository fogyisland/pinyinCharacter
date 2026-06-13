import { describe, it, expect, beforeAll } from 'vitest';
import { initRadicalMap, getRadical, _resetRadicalMapForTest } from '@/lib/radical';

const FIXTURE: Record<string, string> = {
  '你': '亻',
  '好': '女',
  '妈': '女',
  '河': '氵',
  '花': '艹',
};

describe('radical (with injected fixture)', () => {
  beforeAll(() => {
    _resetRadicalMapForTest();
    initRadicalMap(FIXTURE);
  });

  it('returns the radical for a known char', () => {
    expect(getRadical('你')).toBe('亻');
  });
  it('returns null for unknown char', () => {
    expect(getRadical('龘')).toBeNull();
  });
  it('returns null for empty string', () => {
    expect(getRadical('')).toBeNull();
  });
  it('returns null for non-CJK (e.g. ASCII letter)', () => {
    expect(getRadical('a')).toBeNull();
  });
});
