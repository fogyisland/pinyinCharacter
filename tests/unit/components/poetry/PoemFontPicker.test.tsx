// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PoemFontPicker } from '@/components/poetry/PoemFontPicker';

describe('PoemFontPicker', () => {
  it('renders 5 font options: 楷书 / 小楷 / 隶书 / 篆书 / 毛笔', () => {
    render(<PoemFontPicker value="kai" onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: '楷书' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '小楷' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '隶书' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '篆书' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '毛笔' })).toBeInTheDocument();
  });

  it('marks active option with aria-pressed=true', () => {
    render(<PoemFontPicker value="mao-bi" onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: '毛笔' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '楷书' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('calls onChange when an option is clicked', () => {
    const onChange = vi.fn();
    render(<PoemFontPicker value="kai" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: '隶书' }));
    expect(onChange).toHaveBeenCalledWith('li-shu');
  });
});