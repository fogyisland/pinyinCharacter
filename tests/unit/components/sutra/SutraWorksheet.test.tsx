// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

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
void shim;

import { SutraWorksheet } from '@/components/sutra/SutraWorksheet';
import { useAppStore } from '@/lib/store';
import type { SutraChunk } from '@/lib/sutra-types';

const SAMPLE_CHUNK: SutraChunk = {
  id: 1,
  label: '节选',
  content: ['观音', '菩萨'],
  pinyin: [
    ['guān', 'yīn'],
    ['pú', 'sà'],
  ],
};

beforeEach(() => {
  cleanup();
  useAppStore.setState({ showPinyin: true });
});

describe('SutraWorksheet', () => {
  it('renders pinyin spans when showPinyin=true', () => {
    render(<SutraWorksheet chunk={SAMPLE_CHUNK} />);
    expect(screen.getByText('guān')).toBeInTheDocument();
    expect(screen.getByText('yīn')).toBeInTheDocument();
    expect(screen.getByText('pú')).toBeInTheDocument();
    expect(screen.getByText('sà')).toBeInTheDocument();
  });

  it('hides pinyin spans when showPinyin=false', () => {
    useAppStore.setState({ showPinyin: false });
    render(<SutraWorksheet chunk={SAMPLE_CHUNK} />);
    expect(screen.queryByText('guān')).toBeNull();
    expect(screen.queryByText('yīn')).toBeNull();
    expect(screen.queryByText('pú')).toBeNull();
    expect(screen.queryByText('sà')).toBeNull();
  });

  it('still renders the chars themselves regardless of showPinyin', () => {
    useAppStore.setState({ showPinyin: false });
    render(<SutraWorksheet chunk={SAMPLE_CHUNK} />);
    expect(screen.getAllByText('观').length).toBeGreaterThan(0);
    expect(screen.getAllByText('音').length).toBeGreaterThan(0);
  });
});
