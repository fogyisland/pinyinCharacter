import { describe, it, expect } from 'vitest';
import { getRevealConfig, REVEAL_BY_LEVEL } from '@/lib/reveal';

describe('reveal model', () => {
  it('REVEAL_BY_LEVEL has HSK 1 = full (pinyin+meaning+radical)', () => {
    expect(REVEAL_BY_LEVEL[1].cellHints).toEqual(['pinyin', 'meaning', 'radical']);
    expect(REVEAL_BY_LEVEL[1].allowOnDemandHints).toBe(false);
  });

  it('REVEAL_BY_LEVEL has HSK 6 = empty cell, on-demand allowed', () => {
    expect(REVEAL_BY_LEVEL[6].cellHints).toEqual([]);
    expect(REVEAL_BY_LEVEL[6].allowOnDemandHints).toBe(true);
  });

  it('chain game filters radical out of cellHints', () => {
    const cfg = getRevealConfig('chain', 1);
    expect(cfg.cellHints).not.toContain('radical');
    expect(cfg.onDemandPenalty).toBe(0);
  });

  it('drag-match keeps pinyin/meaning but drops radical', () => {
    const cfg = getRevealConfig('drag-match', 1);
    expect(cfg.cellHints).toContain('pinyin');
    expect(cfg.cellHints).toContain('meaning');
    expect(cfg.cellHints).not.toContain('radical');
  });

  it('tone-radical keeps radical in cellHints at HSK 1', () => {
    const cfg = getRevealConfig('tone-radical', 1);
    expect(cfg.cellHints).toContain('radical');
    expect(cfg.onDemandPenalty).toBe(1);
  });

  it('HSK 1-3 disallow on-demand, HSK 4-6 allow', () => {
    expect(getRevealConfig('tone-radical', 1).allowOnDemandHints).toBe(false);
    expect(getRevealConfig('tone-radical', 3).allowOnDemandHints).toBe(false);
    expect(getRevealConfig('tone-radical', 4).allowOnDemandHints).toBe(true);
    expect(getRevealConfig('tone-radical', 6).allowOnDemandHints).toBe(true);
  });
});
