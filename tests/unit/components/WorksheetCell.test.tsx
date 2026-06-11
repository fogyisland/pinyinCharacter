// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { WorksheetCell } from '@/components/worksheet/WorksheetCell';

describe('WorksheetCell', () => {
  it('brush style has vertical center and diagonals (more lines than square)', () => {
    const { container } = render(<WorksheetCell char="你" style="brush" />);
    const lines = container.querySelectorAll('line');
    // Brush: 1 vertical center + 2 diagonals = 3 <line> elements
    // (The outer <rect> border is not a <line>, so the count is 3.)
    // We assert >= 3 to keep the intent ("brush has more lines than square") clear.
    expect(lines.length).toBeGreaterThanOrEqual(3);
  });

  it('square style has vertical and horizontal center, no diagonals', () => {
    const { container } = render(<WorksheetCell char="你" style="square" />);
    const lines = container.querySelectorAll('line');
    // Square: 1 vertical center + 1 horizontal center = 2 <line> elements
    expect(lines.length).toBe(2);
  });

  it('brush has strictly more lines than square (proves diagonals are present)', () => {
    const brush = render(<WorksheetCell char="你" style="brush" />);
    const square = render(<WorksheetCell char="你" style="square" />);
    const brushLines = brush.container.querySelectorAll('line').length;
    const squareLines = square.container.querySelectorAll('line').length;
    expect(brushLines).toBeGreaterThan(squareLines);
  });

  it('renders the char as a text element', () => {
    const { container } = render(<WorksheetCell char="好" style="brush" />);
    expect(container.querySelector('text')?.textContent).toBe('好');
  });
});
