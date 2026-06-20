// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PaperSizePicker } from '@/components/worksheet/PaperSizePicker';

describe('PaperSizePicker (G3)', () => {
  describe('non-brush tools', () => {
    it('renders A3, A4, B5 radios when tool is "pen"', () => {
      render(<PaperSizePicker value="A4" tool="pen" onChange={vi.fn()} />);
      expect(screen.getByText(/A3/)).toBeInTheDocument();
      expect(screen.getByText(/A4/)).toBeInTheDocument();
      expect(screen.getByText(/B5/)).toBeInTheDocument();
    });

    it('does NOT render brush mode buttons when tool is "pen"', () => {
      render(<PaperSizePicker value="A4" tool="pen" onChange={vi.fn()} />);
      expect(screen.queryByText('12 字')).not.toBeInTheDocument();
      expect(screen.queryByText('24 字')).not.toBeInTheDocument();
      expect(screen.queryByText('28 字')).not.toBeInTheDocument();
    });
  });

  describe('brush tool', () => {
    it('renders 3 brush mode buttons when tool is "brush"', () => {
      render(<PaperSizePicker value="brush-12" tool="brush" onChange={vi.fn()} />);
      expect(screen.getByText('12 字')).toBeInTheDocument();
      expect(screen.getByText('24 字')).toBeInTheDocument();
      expect(screen.getByText('28 字')).toBeInTheDocument();
    });

    it('does NOT render A3/A4/B5 radios when tool is "brush"', () => {
      render(<PaperSizePicker value="brush-12" tool="brush" onChange={vi.fn()} />);
      expect(screen.queryByText(/A3 ·/)).not.toBeInTheDocument();
      expect(screen.queryByText(/A4 ·/)).not.toBeInTheDocument();
      expect(screen.queryByText(/B5 ·/)).not.toBeInTheDocument();
    });

    it('calls onChange with the picked brush size', () => {
      const onChange = vi.fn();
      render(<PaperSizePicker value="brush-12" tool="brush" onChange={onChange} />);
      fireEvent.click(screen.getByText('24 字'));
      expect(onChange).toHaveBeenCalledWith('brush-24');
    });

    it('defensively falls back to brush-12 if value is not a brush size', () => {
      const onChange = vi.fn();
      render(<PaperSizePicker value="A4" tool="brush" onChange={onChange} />);
      // Should self-heal: emits onChange('brush-12') and renders 12 字 as selected
      expect(onChange).toHaveBeenCalledWith('brush-12');
    });
  });
});
