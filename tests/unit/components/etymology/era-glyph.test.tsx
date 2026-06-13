// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { EraGlyph } from '@/components/etymology/EraGlyph';

describe('EraGlyph', () => {
  it('renders the char with era font class when hasGlyph=true', () => {
    render(
      <EraGlyph char="一" era="jiaguwen" font="YinQiJiaGuWen" hasGlyph={true} />
    );
    const span = screen.getByText('一');
    expect(span.className).toContain('font-jiaguwen');
  });

  it('renders 「暂无」placeholder when hasGlyph=false', () => {
    render(
      <EraGlyph char="龘" era="jiaguwen" font="YinQiJiaGuWen" hasGlyph={false} />
    );
    expect(screen.getByText('暂无')).toBeInTheDocument();
  });
});
