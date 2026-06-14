import { describe, it, expect } from 'vitest';
import {
  DRAG_MATCH_CONFIG,
  TONE_RADICAL_CONFIG,
  PINYIN_INPUT_CONFIG,
  DEFAULT_DIFFICULTY,
} from './difficulty';

describe('difficulty config', () => {
  it('defaults to medium', () => {
    expect(DEFAULT_DIFFICULTY).toBe('medium');
  });

  it('DragMatchGame: easy=6 / medium=8 / hard=12 chars', () => {
    expect(DRAG_MATCH_CONFIG.easy.count).toBe(6);
    expect(DRAG_MATCH_CONFIG.medium.count).toBe(8);
    expect(DRAG_MATCH_CONFIG.hard.count).toBe(12);
  });

  it('DragMatchGame: source escalates with difficulty', () => {
    expect(DRAG_MATCH_CONFIG.easy.source).toBe('chars-level-1');
    expect(DRAG_MATCH_CONFIG.medium.source).toBe('chars-level-1-2');
    expect(DRAG_MATCH_CONFIG.hard.source).toBe('chars-all');
  });

  it('ToneRadicalGame: easy=3 / medium=4 / hard=6', () => {
    expect(TONE_RADICAL_CONFIG.easy.count).toBe(3);
    expect(TONE_RADICAL_CONFIG.medium.count).toBe(4);
    expect(TONE_RADICAL_CONFIG.hard.count).toBe(6);
  });

  it('PinyinInputMethod: easy=3 / medium=5 / hard=9 candidates', () => {
    expect(PINYIN_INPUT_CONFIG.easy.maxCandidates).toBe(3);
    expect(PINYIN_INPUT_CONFIG.medium.maxCandidates).toBe(5);
    expect(PINYIN_INPUT_CONFIG.hard.maxCandidates).toBe(9);
  });
});