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
    expect(text.getAttribute('stroke')).toBe('none');
    expect(rect.getAttribute('stroke')).toBe('#bbb');
  });

  it('trace mode: full-size char with light gray fill + red outline', () => {
    // 字体的外边缘用红色 — fill light gray, stroke red, like a brush outline
    // the user can trace over with ink.
    const { container } = render(<WorksheetCell char="永" style="brush-trace-square" size={100} />);
    const text = container.querySelector('text')!;
    const rect = container.querySelector('rect')!;
    expect(text.getAttribute('font-size')).toBe('100');   // full size template
    expect(text.getAttribute('fill')).toBe('#ddd');        // light gray inside
    expect(text.getAttribute('stroke')).toBe('#c0392b');   // red outline of the char
    expect(rect.getAttribute('stroke')).toBe('#bbb');      // cell border stays light
  });

  it('trace mode cross: same red-outlined char + diagonals', () => {
    const { container } = render(<WorksheetCell char="永" style="brush-trace-cross" size={100} />);
    const lines = container.querySelectorAll('line');
    expect(lines.length).toBe(5);
    const text = container.querySelector('text')!;
    expect(text.getAttribute('font-size')).toBe('100');
    expect(text.getAttribute('fill')).toBe('#ddd');
    expect(text.getAttribute('stroke')).toBe('#c0392b');
  });

  it('preserves cross diagonals for brush-cross (non-trace)', () => {
    const { container } = render(<WorksheetCell char="永" style="brush-cross" size={100} />);
    const lines = container.querySelectorAll('line');
    expect(lines.length).toBe(5);
    const text = container.querySelector('text')!;
    expect(text.getAttribute('font-size')).toBe('60');
    expect(text.getAttribute('fill')).toBe('#bbb');
    expect(text.getAttribute('stroke')).toBe('none');
  });

  it('uses #bbb stroke for pen outline (no trace)', () => {
    const { container } = render(<WorksheetCell char="永" style="pen-square" size={100} />);
    const rect = container.querySelector('rect')!;
    expect(rect.getAttribute('stroke')).toBe('#bbb');
  });
});