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

import { PoemWorksheet } from '@/components/poetry/PoemWorksheet';
import { useAppStore } from '@/lib/store';

const SAMPLE_CONTENT = ['你好', '世界'];
const SAMPLE_PINYIN = [
  ['nǐ', 'hǎo'],
  ['shì', 'jiè'],
];

beforeEach(() => {
  cleanup();
  useAppStore.setState({ showPinyin: true });
});

describe('PoemWorksheet', () => {
  it('renders pinyin spans for each char when showPinyin=true', () => {
    render(<PoemWorksheet content={SAMPLE_CONTENT} pinyin={SAMPLE_PINYIN} />);
    expect(screen.getByText('nǐ')).toBeInTheDocument();
    expect(screen.getByText('hǎo')).toBeInTheDocument();
    expect(screen.getByText('shì')).toBeInTheDocument();
    expect(screen.getByText('jiè')).toBeInTheDocument();
  });

  it('hides pinyin spans when showPinyin=false', () => {
    useAppStore.setState({ showPinyin: false });
    render(<PoemWorksheet content={SAMPLE_CONTENT} pinyin={SAMPLE_PINYIN} />);
    expect(screen.queryByText('nǐ')).toBeNull();
    expect(screen.queryByText('hǎo')).toBeNull();
    expect(screen.queryByText('shì')).toBeNull();
    expect(screen.queryByText('jiè')).toBeNull();
  });

  it('still renders the chars themselves regardless of showPinyin', () => {
    useAppStore.setState({ showPinyin: false });
    render(<PoemWorksheet content={SAMPLE_CONTENT} pinyin={SAMPLE_PINYIN} />);
    expect(screen.getAllByText('你').length).toBeGreaterThan(0);
    expect(screen.getAllByText('好').length).toBeGreaterThan(0);
    expect(screen.getAllByText('世').length).toBeGreaterThan(0);
    expect(screen.getAllByText('界').length).toBeGreaterThan(0);
  });

  it('does not crash when pinyin has missing entries (showPinyin=true)', () => {
    const partial = [['nǐ', ''], ['']];
    render(<PoemWorksheet content={SAMPLE_CONTENT} pinyin={partial as string[][]} />);
    // Only the non-empty pinyin should appear
    expect(screen.getByText('nǐ')).toBeInTheDocument();
  });
});
