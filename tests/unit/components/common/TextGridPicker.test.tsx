// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TextGridPicker } from '@/components/common/TextGridPicker';

describe('TextGridPicker', () => {
  it('renders 3 options: 默认 / 田字格 / 米字格', () => {
    render(<TextGridPicker value="default" onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: '默认' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '田字格' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '米字格' })).toBeInTheDocument();
  });

  it('marks active option with aria-pressed=true', () => {
    render(<TextGridPicker value="tian" onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: '田字格' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '默认' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: '米字格' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('calls onChange with new value when clicked', () => {
    const onChange = vi.fn();
    render(<TextGridPicker value="default" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: '米字格' }));
    expect(onChange).toHaveBeenCalledWith('mi');
  });
});