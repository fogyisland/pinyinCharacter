// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { GlobalWindow } from 'happy-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReadingModePicker } from './ReadingModePicker';

beforeAll(() => {
  const win = new GlobalWindow({ url: 'http://localhost:3000' });
  Object.defineProperty(globalThis, 'localStorage', {
    get: () => win.localStorage,
    configurable: true,
  });
});

describe('ReadingModePicker', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders all three modes', () => {
    render(<ReadingModePicker value="horizontal" onChange={() => {}} />);
    expect(screen.getByText('横向')).toBeTruthy();
    expect(screen.getByText('竖排从右到左')).toBeTruthy();
    expect(screen.getByText('竖排从左到右')).toBeTruthy();
  });

  it('highlights the active value', () => {
    render(<ReadingModePicker value="vertical-rtl" onChange={() => {}} />);
    const rtlBtn = screen.getByText('竖排从右到左').closest('button')!;
    expect(rtlBtn.className).toMatch(/bg-seal|text-paper/);
  });

  it('calls onChange with the clicked mode', () => {
    const onChange = vi.fn();
    render(<ReadingModePicker value="horizontal" onChange={onChange} />);
    fireEvent.click(screen.getByText('竖排从左到右'));
    expect(onChange).toHaveBeenCalledWith('vertical-ltr');
  });
});