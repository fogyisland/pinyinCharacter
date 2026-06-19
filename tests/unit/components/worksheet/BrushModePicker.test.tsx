// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BrushModePicker } from '@/components/worksheet/BrushModePicker';

describe('BrushModePicker', () => {
  it('renders 3 buttons: 12 字, 24 字, 28 字', () => {
    render(<BrushModePicker value="brush-12" onChange={vi.fn()} />);
    expect(screen.getByText('12 字')).toBeInTheDocument();
    expect(screen.getByText('24 字')).toBeInTheDocument();
    expect(screen.getByText('28 字')).toBeInTheDocument();
  });

  it('marks the current value with the selected style (border-seal + bg-seal/10)', () => {
    render(<BrushModePicker value="brush-24" onChange={vi.fn()} />);
    const selectedBtn = screen.getByText('24 字').closest('button')!;
    expect(selectedBtn.className).toContain('border-seal');
    expect(selectedBtn.className).toContain('bg-seal/10');
    expect(selectedBtn.getAttribute('aria-pressed')).toBe('true');
  });

  it('non-selected buttons do not have the selected style', () => {
    render(<BrushModePicker value="brush-12" onChange={vi.fn()} />);
    const otherBtn = screen.getByText('24 字').closest('button')!;
    expect(otherBtn.className).not.toContain('border-seal');
    expect(otherBtn.getAttribute('aria-pressed')).toBe('false');
  });

  it('calls onChange with the picked brush mode when a button is clicked', () => {
    const onChange = vi.fn();
    render(<BrushModePicker value="brush-12" onChange={onChange} />);
    fireEvent.click(screen.getByText('28 字'));
    expect(onChange).toHaveBeenCalledWith('brush-28');
  });
});
