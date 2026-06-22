// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { WorksheetCell } from '@/components/worksheet/WorksheetCell';

describe('WorksheetCell', () => {
  it('renders char at 60% size in #bbb for non-trace styles', () => {
    const { container } = render(<WorksheetCell char="永" style="brush-square" size={100} />);
    const text = container.querySelector('text')!;
    expect(text.getAttribute('font-size')).toBe('60');
    expect(text.getAttribute('fill')).toBe('#bbb');
  });

  it('renders char at 100% size in #666 for brush-trace-square', () => {
    const { container } = render(<WorksheetCell char="永" style="brush-trace-square" size={100} />);
    const text = container.querySelector('text')!;
    expect(text.getAttribute('font-size')).toBe('100');
    expect(text.getAttribute('fill')).toBe('#666');
  });

  it('renders char at 100% size in #666 for brush-trace-cross (with diagonals)', () => {
    const { container } = render(<WorksheetCell char="永" style="brush-trace-cross" size={100} />);
    const lines = container.querySelectorAll('line');
    expect(lines.length).toBe(5);
    const text = container.querySelector('text')!;
    expect(text.getAttribute('font-size')).toBe('100');
    expect(text.getAttribute('fill')).toBe('#666');
  });

  it('preserves cross diagonals for brush-cross (non-trace)', () => {
    const { container } = render(<WorksheetCell char="永" style="brush-cross" size={100} />);
    const lines = container.querySelectorAll('line');
    expect(lines.length).toBe(5);
    const text = container.querySelector('text')!;
    expect(text.getAttribute('font-size')).toBe('60');
  });

  it('uses #666 stroke for trace outline (rect)', () => {
    const { container } = render(<WorksheetCell char="永" style="brush-trace-square" size={100} />);
    const rect = container.querySelector('rect')!;
    expect(rect.getAttribute('stroke')).toBe('#666');
  });

  it('uses #bbb stroke for non-trace outline (rect)', () => {
    const { container } = render(<WorksheetCell char="永" style="pen-square" size={100} />);
    const rect = container.querySelector('rect')!;
    expect(rect.getAttribute('stroke')).toBe('#bbb');
  });
});