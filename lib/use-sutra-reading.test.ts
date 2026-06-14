// @vitest-environment happy-dom
import { describe, expect, it, beforeAll, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { GlobalWindow } from 'happy-dom';
import { useSutraReading } from './use-sutra-reading';
import { DEFAULT_SUTRA_READING } from './sutra-reading';

beforeAll(() => {
  const win = new GlobalWindow({ url: 'http://localhost:3000' });
  Object.defineProperty(globalThis, 'localStorage', {
    get: () => win.localStorage,
    configurable: true,
  });
});

beforeEach(() => {
  window.localStorage.clear();
});

describe('useSutraReading', () => {
  it('starts at default when localStorage empty', () => {
    const { result } = renderHook(() => useSutraReading());
    expect(result.current[0]).toBe(DEFAULT_SUTRA_READING);
  });

  it('persists mode to localStorage on change', () => {
    const { result } = renderHook(() => useSutraReading());
    act(() => result.current[1]('vertical-rtl'));
    expect(window.localStorage.getItem('pinyin:sutra-reading')).toBe('vertical-rtl');
    expect(result.current[0]).toBe('vertical-rtl');
  });

  it('reads valid stored value', () => {
    window.localStorage.setItem('pinyin:sutra-reading', 'vertical-ltr');
    const { result } = renderHook(() => useSutraReading());
    expect(result.current[0]).toBe('vertical-ltr');
  });

  it('falls back to default for invalid stored value', () => {
    window.localStorage.setItem('pinyin:sutra-reading', 'garbage');
    const { result } = renderHook(() => useSutraReading());
    expect(result.current[0]).toBe(DEFAULT_SUTRA_READING);
  });
});