// @vitest-environment happy-dom
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { EtymologyMorph } from '@/components/etymology/EtymologyMorph';

const fullGlyphs = [
  { era: 'jiaguwen' as const, font: 'YinQiJiaGuWen', hasGlyph: true },
  { era: 'jinwen' as const, font: 'HanDianJinWen', hasGlyph: true },
  { era: 'xiaozhuan' as const, font: 'QuanZiKuShuoWen', hasGlyph: true },
  { era: 'lishu' as const, font: 'QuanZiKuLiDing', hasGlyph: true },
  { era: 'kaishu' as const, font: 'KaiTi', hasGlyph: true },
];

describe('EtymologyMorph', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the first era (jiaguwen) visibly by default', () => {
    render(<EtymologyMorph char="一" eraGlyphs={fullGlyphs} story="演变故事" level={1} />);
    // The first era is the visible one (opacity-100); others opacity-0
    const jiaguwen = screen.getAllByText('一').find(
      (el) => el.className.includes('font-jiaguwen')
    );
    expect(jiaguwen).toBeDefined();
    expect(jiaguwen!.className).toContain('opacity-100');
  });

  it('marks non-current era glyphs aria-hidden=true', () => {
    render(<EtymologyMorph char="一" eraGlyphs={fullGlyphs} story="演变故事" level={1} />);
    const allEras = screen.getAllByText('一');
    const hidden = allEras.filter((el) => el.getAttribute('aria-hidden') === 'true');
    const visible = allEras.filter((el) => el.getAttribute('aria-hidden') === 'false');
    expect(visible).toHaveLength(1);
    expect(hidden).toHaveLength(4);
  });

  it('clicking an era chip jumps to that era and pauses autoplay', () => {
    render(<EtymologyMorph char="一" eraGlyphs={fullGlyphs} story="演变故事" level={1} />);
    fireEvent.click(screen.getByRole('button', { name: '隶书' }));
    const lishu = screen.getAllByText('一').find(
      (el) => el.className.includes('font-lishu')
    );
    expect(lishu!.className).toContain('opacity-100');
    // After click, the play/pause button should now read "▶" (paused state)
    expect(screen.getByRole('button', { name: '播放' })).toBeInTheDocument();
  });

  it('autoplay advances currentIndex every 1200ms and wraps around', () => {
    render(<EtymologyMorph char="一" eraGlyphs={fullGlyphs} story="演变故事" level={1} />);
    // Filter to era spans (have opacity class), not header <h2>
    const eraSpans = () =>
      screen.getAllByText('一').filter((el) =>
        el.className.includes('opacity-100') || el.className.includes('opacity-0')
      );
    // After 1200ms → jiaguwen (0) → jinwen (1)
    act(() => { vi.advanceTimersByTime(1200); });
    const jinwen = eraSpans().find((el) => el.className.includes('font-jinwen'));
    expect(jinwen!.className).toContain('opacity-100');
    // Advance enough to wrap around (4 more ticks from index 1 → 1+4=5 → 5 mod 5 = 0)
    act(() => { vi.advanceTimersByTime(4 * 1200); });
    // Back to jiaguwen
    const jiaguwen = eraSpans().find((el) => el.className.includes('font-jiaguwen'));
    expect(jiaguwen!.className).toContain('opacity-100');
  });

  it('play/pause toggle button stops and resumes the autoplay', () => {
    render(<EtymologyMorph char="一" eraGlyphs={fullGlyphs} story="演变故事" level={1} />);
    // Default: playing, label "暂停"
    expect(screen.getByRole('button', { name: '暂停' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '暂停' }));
    expect(screen.getByRole('button', { name: '播放' })).toBeInTheDocument();
    // After pause, advancing timers should NOT change currentIndex
    const before = screen.getAllByText('一').find(
      (el) => el.className.includes('font-jiaguwen')
    )!.className;
    act(() => { vi.advanceTimersByTime(5000); });
    const after = screen.getAllByText('一').find(
      (el) => el.className.includes('font-jiaguwen')
    )!.className;
    expect(before).toContain('opacity-100');
    expect(after).toContain('opacity-100');
  });

  it('does not autoplay when eras.length === 1', () => {
    const oneGlyph = [fullGlyphs[0]];
    render(<EtymologyMorph char="一" eraGlyphs={oneGlyph} story="演变故事" level={1} />);
    act(() => { vi.advanceTimersByTime(10000); });
    // Still on the only era
    const only = screen.getAllByText('一').find(
      (el) => el.className.includes('font-jiaguwen')
    );
    expect(only!.className).toContain('opacity-100');
  });

  it('renders the fallback message when eras is empty', () => {
    render(<EtymologyMorph char="一" eraGlyphs={[]} story={null} level={1} />);
    expect(screen.getByText(/暂无字源数据/)).toBeInTheDocument();
  });

  it('keyboard: Space toggles play/pause', () => {
    render(<EtymologyMorph char="一" eraGlyphs={fullGlyphs} story="演变故事" level={1} />);
    // Default: playing
    expect(screen.getByRole('button', { name: '暂停' })).toBeInTheDocument();
    // Fire Space on the section container
    const section = screen.getByRole('region', { name: '字形演变' });
    fireEvent.keyDown(section, { key: ' ' });
    expect(screen.getByRole('button', { name: '播放' })).toBeInTheDocument();
  });

  it('keyboard: ArrowRight advances the current era (no wrap with autoplay on)', () => {
    render(<EtymologyMorph char="一" eraGlyphs={fullGlyphs} story="演变故事" level={1} />);
    const section = screen.getByRole('region', { name: '字形演变' });
    // Jump to 隶书 directly via arrow
    fireEvent.keyDown(section, { key: 'ArrowRight' });
    fireEvent.keyDown(section, { key: 'ArrowRight' });
    fireEvent.keyDown(section, { key: 'ArrowRight' });
    const lishu = screen.getAllByText('一').find(
      (el) => el.className.includes('font-lishu')
    );
    expect(lishu!.className).toContain('opacity-100');
  });

  it('keyboard: Home/End jump to first/last era', () => {
    render(<EtymologyMorph char="一" eraGlyphs={fullGlyphs} story="演变故事" level={1} />);
    const section = screen.getByRole('region', { name: '字形演变' });
    // Filter to era spans only (header <h2> also has font-kai)
    const eraSpans = () =>
      screen.getAllByText('一').filter((el) =>
        el.className.includes('opacity-100') || el.className.includes('opacity-0')
      );
    fireEvent.keyDown(section, { key: 'End' });
    const kaishu = eraSpans().find((el) => el.className.includes('font-kai'));
    expect(kaishu!.className).toContain('opacity-100');
    fireEvent.keyDown(section, { key: 'Home' });
    const jiaguwen = eraSpans().find((el) => el.className.includes('font-jiaguwen'));
    expect(jiaguwen!.className).toContain('opacity-100');
  });

  it('shows the level badge with the correct Chinese label', () => {
    const { rerender } = render(<EtymologyMorph char="一" eraGlyphs={fullGlyphs} story="演变故事" level={1} />);
    expect(screen.getByText('一级')).toBeInTheDocument();
    rerender(<EtymologyMorph char="一" eraGlyphs={fullGlyphs} story="演变故事" level={2} />);
    expect(screen.getByText('二级')).toBeInTheDocument();
    rerender(<EtymologyMorph char="一" eraGlyphs={fullGlyphs} story="演变故事" level={3} />);
    expect(screen.getByText('三级')).toBeInTheDocument();
  });

  it('shows the coverage hint based on era count + level', () => {
    const { rerender } = render(<EtymologyMorph char="一" eraGlyphs={fullGlyphs} story="演变故事" level={1} />);
    expect(screen.getByText(/5\/5 字形 · 完整/)).toBeInTheDocument();

    const partialGlyphs = fullGlyphs.slice(0, 2);
    rerender(<EtymologyMorph char="一" eraGlyphs={partialGlyphs} story="演变故事" level={2} />);
    expect(screen.getByText(/2\/5 字形 · 部分 \(L2/)).toBeInTheDocument();
  });
});