// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { WorksheetCell } from '@/components/worksheet/WorksheetCell';

describe('WorksheetCell', () => {
  it('brush-cross has vertical center, horizontal, and diagonals (most lines)', () => {
    const { container } = render(<WorksheetCell char="你" style="brush-cross" />);
    const lines = container.querySelectorAll('line');
    // brush-cross: 1 vertical + 1 horizontal + 2 diagonals = 4 <line> elements
    expect(lines.length).toBe(4);
  });

  it('pen-square has vertical and horizontal center, no diagonals', () => {
    const { container } = render(<WorksheetCell char="你" style="pen-square" />);
    const lines = container.querySelectorAll('line');
    // pen-square: 1 vertical + 1 horizontal = 2 <line> elements
    expect(lines.length).toBe(2);
  });

  it('pen-square and brush-square have the same line count (presentation drives grid)', () => {
    const pen = render(<WorksheetCell char="你" style="pen-square" />);
    const brush = render(<WorksheetCell char="你" style="brush-square" />);
    expect(pen.container.querySelectorAll('line').length).toBe(brush.container.querySelectorAll('line').length);
  });

  it('cross has strictly more lines than square (proves diagonals are present)', () => {
    const cross = render(<WorksheetCell char="你" style="brush-cross" />);
    const square = render(<WorksheetCell char="你" style="pen-square" />);
    const crossLines = cross.container.querySelectorAll('line').length;
    const squareLines = square.container.querySelectorAll('line').length;
    expect(crossLines).toBeGreaterThan(squareLines);
  });

  it('renders the char as a text element', () => {
    const { container } = render(<WorksheetCell char="好" style="brush-cross" />);
    expect(container.querySelector('text')?.textContent).toBe('好');
  });
});
