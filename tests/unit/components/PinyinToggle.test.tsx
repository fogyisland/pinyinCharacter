// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';

// happy-dom's localStorage is an empty object {} with no setItem/getItem.
// Zustand persist needs a real Storage interface. Install the shim BEFORE
// any module loads, via vi.hoisted (which runs before imports).
const shim = vi.hoisted(() => {
  const memStore: Record<string, string> = {};
  const obj = {
    getItem: (k: string) => memStore[k] ?? null,
    setItem: (k: string, v: string) => { memStore[k] = v; },
    removeItem: (k: string) => { delete memStore[k]; },
    clear: () => { for (const k of Object.keys(memStore)) delete memStore[k]; },
    key: (i: number) => Object.keys(memStore)[i] ?? null,
    get length() { return Object.keys(memStore).length; },
  };
  (globalThis as any).localStorage = obj;
  if (typeof window !== 'undefined') (window as any).localStorage = obj;
  return obj;
});
// Reference the hoisted shim so it isn't tree-shaken (it isn't, but TS
// would complain about an unused expression otherwise).
void shim;

import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { PinyinToggle } from '@/components/PinyinToggle';
import { useAppStore } from '@/lib/store';

beforeEach(() => {
  cleanup();
  useAppStore.setState({ showPinyin: true });
});

describe('PinyinToggle', () => {
  it('renders a switch with default state checked (showPinyin=true)', () => {
    render(<PinyinToggle />);
    const sw = screen.getByRole('switch');
    expect(sw).toHaveAttribute('aria-checked', 'true');
  });

  it('renders unchecked when showPinyin is false', () => {
    useAppStore.setState({ showPinyin: false });
    render(<PinyinToggle />);
    const sw = screen.getByRole('switch');
    expect(sw).toHaveAttribute('aria-checked', 'false');
  });

  it('flips store value on click (true → false)', () => {
    render(<PinyinToggle />);
    fireEvent.click(screen.getByRole('switch'));
    expect(useAppStore.getState().showPinyin).toBe(false);
  });

  it('flips store value on click (false → true)', () => {
    useAppStore.setState({ showPinyin: false });
    render(<PinyinToggle />);
    fireEvent.click(screen.getByRole('switch'));
    expect(useAppStore.getState().showPinyin).toBe(true);
  });

  it('renders the label "显示拼音"', () => {
    render(<PinyinToggle />);
    expect(screen.getByText('显示拼音')).toBeInTheDocument();
  });
});
