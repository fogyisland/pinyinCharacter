// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { WorksheetCell } from '@/components/worksheet/WorksheetCell';

describe('WorksheetCell — lined branch (pen-lined)', () => {
  it('renders an SVG with width=100% and the line cell height', () => {
    const { container } = render(<WorksheetCell char="" style="pen-lined" size={38} />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('width')).toBe('100%');
    expect(svg?.getAttribute('height')).toBe('38');
  });

  it('uses a viewBox scaled so the line stretches (preserveAspectRatio="none")', () => {
    const { container } = render(<WorksheetCell char="" style="pen-lined" size={38} />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('preserveAspectRatio')).toBe('none');
    // viewBox: width=100 (sentinel for stretching), height=size
    expect(svg?.getAttribute('viewBox')).toBe('0 0 100 38');
  });

  it('renders exactly one <line> for the bottom rule with non-scaling stroke', () => {
    const { container } = render(<WorksheetCell char="" style="pen-lined" size={38} />);
    const lines = container.querySelectorAll('line');
    expect(lines.length).toBe(1);
    const line = lines[0];
    // y = size - 0.5 keeps the 1px stroke crisply above the cell bottom edge
    expect(line?.getAttribute('y1')).toBe('37.5');
    expect(line?.getAttribute('y2')).toBe('37.5');
    // x stretches across the full viewBox (0 → 100)
    expect(line?.getAttribute('x1')).toBe('0');
    expect(line?.getAttribute('x2')).toBe('100');
    expect(line?.getAttribute('vector-effect')).toBe('non-scaling-stroke');
    expect(line?.getAttribute('stroke')).toBe('#bbb');
  });

  it('does not render any text (lined is a blank rule, not a character)', () => {
    const { container } = render(<WorksheetCell char="一" style="pen-lined" size={38} />);
    expect(container.querySelector('text')).toBeNull();
  });
});

describe('WorksheetCell — square/cross branches unchanged (regression)', () => {
  it('pen-square still renders a single <rect> outer border', () => {
    const { container } = render(<WorksheetCell char="一" style="pen-square" size={80} />);
    const rects = container.querySelectorAll('rect');
    expect(rects.length).toBe(1);
  });
  it('pen-cross renders 5 <line> elements (vertical + horizontal + 2 diagonals + y=90 baseline guide)', () => {
    const { container } = render(<WorksheetCell char="一" style="pen-cross" size={80} />);
    const lines = container.querySelectorAll('line');
    expect(lines.length).toBe(5);
  });
});