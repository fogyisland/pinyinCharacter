// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { HskLevel } from '@/lib/difficulty';

// 2026-07-04: vi.hoisted makes the mock-state object available to the
// hoisted vi.mock factory (vitest hoists vi.mock above imports). Tests
// mutate `mockState.hskLevel` per `it` block; the factory reads it on
// each dynamic import.
const mockState = vi.hoisted(() => ({
  hskLevel: 1 as HskLevel,
  difficulty: 'medium' as const,
}));

vi.mock('@/lib/use-difficulty', () => ({
  useDifficulty: () => ({
    difficulty: 'medium',
    hskLevel: mockState.hskLevel,
    setDifficulty: vi.fn(),
    setHskLevel: vi.fn(),
  }),
}));

const sampleChars = [
  { char: '安', pinyin: 'ān', pinyinAlt: [], radical: '宀', strokeCount: 6, meaningZh: 'peace', meaningEn: 'peace', unicodeCodepoint: '5B89', variants: [], hskLevel: 1, level: 1 as const },
  { char: '那', pinyin: 'nà', pinyinAlt: [], radical: '阝', strokeCount: 6, meaningZh: 'that', meaningEn: 'that', unicodeCodepoint: '90A3', variants: [], hskLevel: 1, level: 1 as const },
];

function mockFetchChars(json: unknown) {
  vi.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => json,
  } as Response);
}

describe('DragMatchGame — HSK reveal wiring (Task 9)', () => {
  beforeEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.resetModules();
    const store = new Map<string, string>();
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => { store.set(k, v); },
        removeItem: (k: string) => { store.delete(k); },
        clear: () => { store.clear(); },
        key: (i: number) => Array.from(store.keys())[i] ?? null,
        get length() { return store.size; },
      },
    });
  });

  it('threads revealConfig to CharDropZone (HSK 1: pinyin + meaning hints visible)', async () => {
    mockState.hskLevel = 1;
    // DragMatchGame makes two fetches: fetchChars for the pool and a
    // /api/chars probe to read hskFallback. Return identical shape for
    // both.
    mockFetchChars({ ok: true, data: { chars: sampleChars, total: sampleChars.length, page: 1, pageSize: 10 }, hskFallback: false });
    const { DragMatchGame } = await import('@/components/game/DragMatchGame');
    render(<DragMatchGame />);
    await waitFor(() => {
      expect(screen.queryByText(/加载中/)).toBeNull();
    });
    // HSK 1 cellHints for drag-match is ['pinyin','meaning'].
    expect(document.querySelectorAll('[data-hint="pinyin"]').length).toBeGreaterThan(0);
    expect(document.querySelectorAll('[data-hint="meaning"]').length).toBeGreaterThan(0);
    expect(document.querySelectorAll('[data-hint="radical"]').length).toBe(0);
  });

  it('on-demand reveal click bumps mismatches by onDemandPenalty (HSK 6)', async () => {
    mockState.hskLevel = 6;
    mockFetchChars({ ok: true, data: { chars: sampleChars, total: sampleChars.length, page: 1, pageSize: 10 }, hskFallback: false });
    const { DragMatchGame } = await import('@/components/game/DragMatchGame');
    render(<DragMatchGame />);
    await waitFor(() => {
      expect(screen.queryByText(/加载中/)).toBeNull();
    });
    // At HSK 6 no hints visible, but ? buttons render (allowOnDemandHints=true).
    expect(screen.getAllByLabelText('显示拼音').length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByLabelText('显示拼音')[0]!);
    // After click, mismatches counter increments (penalty=1).
    expect(screen.getByText(/错配: 1/)).toBeTruthy();
  });

  it('renders FallbackBanner when hskFallback=true from server', async () => {
    mockState.hskLevel = 5;
    // First call (fetchChars via /api/chars) returns the data. Second call
    // (the hskFallback probe) returns hskFallback=true.
    let callCount = 0;
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      callCount += 1;
      const hskFallback = callCount >= 2; // first call is fetchChars data, subsequent is probe
      return {
        ok: true,
        json: async () => ({
          ok: true,
          data: { chars: sampleChars, total: sampleChars.length, page: 1, pageSize: 10 },
          hskFallback,
        }),
      } as Response;
    });
    const { DragMatchGame } = await import('@/components/game/DragMatchGame');
    render(<DragMatchGame />);
    await waitFor(() => {
      expect(screen.queryByText(/加载中/)).toBeNull();
    });
    const status = screen.getByRole('status');
    expect(status.textContent).toContain('HSK 5');
    expect(status.textContent).toContain('HSK 4');
  });

  it('does NOT render FallbackBanner when hskFallback=false', async () => {
    mockState.hskLevel = 1;
    mockFetchChars({ ok: true, data: { chars: sampleChars, total: sampleChars.length, page: 1, pageSize: 10 }, hskFallback: false });
    const { DragMatchGame } = await import('@/components/game/DragMatchGame');
    render(<DragMatchGame />);
    await waitFor(() => {
      expect(screen.queryByText(/加载中/)).toBeNull();
    });
    expect(screen.queryByRole('status')).toBeNull();
  });
});
