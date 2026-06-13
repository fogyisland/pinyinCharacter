// @vitest-environment happy-dom
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { EtymologyTimeline } from '@/components/etymology/EtymologyTimeline';

const glyphs = [
  { era: 'jiaguwen' as const, font: 'YinQiJiaGuWen', hasGlyph: true },
  { era: 'jinwen' as const, font: 'HanDianJinWen', hasGlyph: true },
  { era: 'xiaozhuan' as const, font: 'QuanZiKuShuoWen', hasGlyph: true },
  { era: 'lishu' as const, font: 'QuanZiKuLiDing', hasGlyph: true },
  { era: 'kaishu' as const, font: 'KaiTi', hasGlyph: true },
];

describe('EtymologyTimeline', () => {
  it('renders 5 era dots', () => {
    render(
      <EtymologyTimeline char="一" eraGlyphs={glyphs} story="演变故事" />
    );
    const dots = screen.getAllByRole('button', {
      name: /甲骨文|金文|小篆|隶书|楷书/,
    });
    expect(dots).toHaveLength(5);
  });

  it('kaishu is active by default (last era)', () => {
    render(
      <EtymologyTimeline char="一" eraGlyphs={glyphs} story="演变故事" />
    );
    expect(screen.getAllByText('一').length).toBeGreaterThan(0);
  });

  it('switches active era on click', () => {
    render(
      <EtymologyTimeline char="一" eraGlyphs={glyphs} story="演变故事" />
    );
    fireEvent.click(screen.getByRole('button', { name: '甲骨文' }));
    const bigChar = screen
      .getAllByText('一')
      .find((el) => el.className.includes('text-7xl'));
    expect(bigChar?.className).toContain('font-jiaguwen');
  });

  it('right arrow key does not advance past kaishu (clamp)', () => {
    render(
      <EtymologyTimeline char="一" eraGlyphs={glyphs} story="演变故事" />
    );
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    // Should still be at kaishu (clamped)
    const bigChar = screen
      .getAllByText('一')
      .find((el) => el.className.includes('text-7xl'));
    expect(bigChar?.className).toContain('font-kai');
  });
});
