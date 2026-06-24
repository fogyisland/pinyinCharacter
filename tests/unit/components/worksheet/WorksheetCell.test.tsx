// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { WorksheetCell } from '@/components/worksheet/WorksheetCell';

describe('WorksheetCell', () => {
  it('renders char at 60% size in #bbb for non-trace styles', () => {
    const { container } = render(<WorksheetCell char="永" style="brush-square" size={100} />);
    const text = container.querySelector('text')!;
    const rect = container.querySelector('rect')!;
    expect(text.getAttribute('font-size')).toBe('60');
    expect(text.getAttribute('fill')).toBe('#bbb');
    expect(rect.getAttribute('stroke')).toBe('#bbb');
  });

  it('renders char at 100% size in #ddd for brush-trace-square (light char + red border)', () => {
    const { container } = render(<WorksheetCell char="永" style="brush-trace-square" size={100} />);
    const text = container.querySelector('text')!;
    const rect = container.querySelector('rect')!;
    expect(text.getAttribute('font-size')).toBe('100');
    expect(text.getAttribute('fill')).toBe('#ddd');        // light gray for the trace char
    expect(rect.getAttribute('stroke')).toBe('#c0392b');   // red border marks the trace cell
  });

  it('renders char at 100% size in #ddd for brush-trace-cross (with diagonals)', () => {
    const { container } = render(<WorksheetCell char="永" style="brush-trace-cross" size={100} />);
    const lines = container.querySelectorAll('line');
    expect(lines.length).toBe(5);
    const text = container.querySelector('text')!;
    const rect = container.querySelector('rect')!;
    expect(text.getAttribute('font-size')).toBe('100');
    expect(text.getAttribute('fill')).toBe('#ddd');
    expect(rect.getAttribute('stroke')).toBe('#c0392b');
  });

  it('preserves cross diagonals for brush-cross (non-trace)', () => {
    const { container } = render(<WorksheetCell char="永" style="brush-cross" size={100} />);
    const lines = container.querySelectorAll('line');
    expect(lines.length).toBe(5);
    const text = container.querySelector('text')!;
    expect(text.getAttribute('font-size')).toBe('60');
  });

  it('uses #bbb stroke for non-trace outline (pen)', () => {
    const { container } = render(<WorksheetCell char="永" style="pen-square" size={100} />);
    const rect = container.querySelector('rect')!;
    expect(rect.getAttribute('stroke')).toBe('#bbb');
  });
});