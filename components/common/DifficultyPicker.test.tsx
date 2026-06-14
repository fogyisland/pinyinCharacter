// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { GlobalWindow } from 'happy-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import { DifficultyPicker } from './DifficultyPicker';

// happy-dom 20 in vitest 2.1.9 exposes `localStorage` on globalThis as a
// plain object (no Storage prototype). Replace it with a real Storage
// instance from a fresh GlobalWindow so setItem/getItem/clear work.
beforeAll(() => {
  const win = new GlobalWindow({ url: 'http://localhost:3000' });
  Object.defineProperty(globalThis, 'localStorage', {
    get: () => win.localStorage,
    configurable: true,
  });
});

describe('DifficultyPicker', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders all three options', () => {
    render(<DifficultyPicker value="medium" onChange={() => {}} />);
    expect(screen.getByText('简单')).toBeTruthy();
    expect(screen.getByText('复杂')).toBeTruthy();
    expect(screen.getByText('超难')).toBeTruthy();
  });

  it('highlights the active value', () => {
    render(<DifficultyPicker value="easy" onChange={() => {}} />);
    const easyBtn = screen.getByText('简单').closest('button')!;
    expect(easyBtn.className).toMatch(/bg-seal|text-paper/);
  });

  it('calls onChange when a button is clicked', () => {
    const onChange = vi.fn();
    render(<DifficultyPicker value="medium" onChange={onChange} />);
    fireEvent.click(screen.getByText('超难'));
    expect(onChange).toHaveBeenCalledWith('hard');
  });
});
