// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { WorksheetPreview } from '@/components/worksheet/WorksheetPreview';

const baseProps = {
  content: ['学', '而', '时', '习', '之', '不', '亦', '说', '乎'],
  cellStyle: 'pen-square' as const,
  paperSize: 'A4' as const,
  fontFamily: 'song' as const,
  showHeader: false,
};

describe('WorksheetPreview with breakpoints', () => {
  it('renders separator div at breakpoint index', () => {
    // Breakpoint BEFORE cell at index 5 (between "之" and "不") — mimics 。 after "之"
    const { container } = render(
      <WorksheetPreview {...baseProps} breakpoints={new Set([5])} />,
    );
    const seps = container.querySelectorAll('.worksheet-cell-sep');
    expect(seps).toHaveLength(1);
    expect(seps[0]).toHaveClass('print:hidden');
    expect(seps[0]).toHaveClass('col-span-full');
  });

  it('renders no separator when breakpoints is empty', () => {
    const { container } = render(
      <WorksheetPreview {...baseProps} breakpoints={new Set()} />,
    );
    expect(container.querySelectorAll('.worksheet-cell-sep')).toHaveLength(0);
  });

  it('does not render separator when breakpoints prop is omitted', () => {
    const { container } = render(<WorksheetPreview {...baseProps} />);
    expect(container.querySelectorAll('.worksheet-cell-sep')).toHaveLength(0);
  });

  it('separator is OUTSIDE any worksheet-cell div', () => {
    const { container } = render(
      <WorksheetPreview {...baseProps} breakpoints={new Set([5])} />,
    );
    const sep = container.querySelector('.worksheet-cell-sep');
    expect(sep?.querySelector('.worksheet-cell')).toBeNull();
  });
});
