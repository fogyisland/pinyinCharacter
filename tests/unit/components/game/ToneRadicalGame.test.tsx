// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { GameRound } from '@/lib/api-game';
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

const sampleRound: GameRound = {
  mode: 'tone',
  chars: [
    { char: '安', pinyin: 'ān', meaning: 'peace', radical: '宀' },
    { char: '那', pinyin: 'nà', meaning: 'that', radical: '阝' },
  ],
  charToAnswer: {
    '安': { tone: 1, radical: '宀', pinyin: 'ān' },
    '那': { tone: 4, radical: '阝', pinyin: 'nà' },
  },
  toneChoices: [1, 2, 3, 4],
  radicalChoices: ['宀', '阝'],
  pinyinChoices: ['ān', 'nà'],
};

function mockFetchOnce(json: unknown) {
  vi.spyOn(global, 'fetch').mockResolvedValueOnce({
    ok: true,
    json: async () => json,
  } as Response);
}

describe('ToneRadicalGame — HSK reveal wiring (Task 8)', () => {
  beforeEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.resetModules();
    // 2026-07-04: happy-dom localStorage shim — useDifficulty reads from
    // localStorage in a useEffect.
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

  it('threads revealConfig to ToneRadicalChar (HSK 1: all hints visible)', async () => {
    mockState.hskLevel = 1;
    mockFetchOnce({ ok: true, data: sampleRound, hskFallback: false });
    const { ToneRadicalGame } = await import('@/components/game/ToneRadicalGame');
    render(<ToneRadicalGame />);
    await waitFor(() => {
      expect(screen.queryByText(/加载中/)).toBeNull();
    });
    // HSK 1 should render pinyin, meaning, radical hints for each char.
    expect(document.querySelectorAll('[data-hint="pinyin"]').length).toBeGreaterThan(0);
    expect(document.querySelectorAll('[data-hint="meaning"]').length).toBeGreaterThan(0);
    expect(document.querySelectorAll('[data-hint="radical"]').length).toBeGreaterThan(0);
  });

  it('on-demand reveal click bumps mismatches by onDemandPenalty (HSK 6)', async () => {
    mockState.hskLevel = 6;
    mockFetchOnce({ ok: true, data: sampleRound, hskFallback: false });
    const { ToneRadicalGame } = await import('@/components/game/ToneRadicalGame');
    render(<ToneRadicalGame />);
    await waitFor(() => {
      expect(screen.queryByText(/加载中/)).toBeNull();
    });
    // At HSK 6 no hints visible, but ? buttons render.
    expect(screen.getAllByLabelText('显示拼音').length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByLabelText('显示拼音')[0]!);
    // After click, mismatches counter increments (penalty=1).
    // Counter is rendered as "错配: N".
    expect(screen.getByText(/错配: 1/)).toBeTruthy();
  });

  it('renders FallbackBanner when hskFallback=true from server', async () => {
    mockState.hskLevel = 5;
    mockFetchOnce({ ok: true, data: sampleRound, hskFallback: true });
    const { ToneRadicalGame } = await import('@/components/game/ToneRadicalGame');
    render(<ToneRadicalGame />);
    await waitFor(() => {
      expect(screen.queryByText(/加载中/)).toBeNull();
    });
    // FallbackBanner renders role=status and mentions HSK 5 + HSK 4 fallback.
    const status = screen.getByRole('status');
    expect(status.textContent).toContain('HSK 5');
    expect(status.textContent).toContain('HSK 4');
  });

  it('does NOT render FallbackBanner when hskFallback=false', async () => {
    mockState.hskLevel = 1;
    mockFetchOnce({ ok: true, data: sampleRound, hskFallback: false });
    const { ToneRadicalGame } = await import('@/components/game/ToneRadicalGame');
    render(<ToneRadicalGame />);
    await waitFor(() => {
      expect(screen.queryByText(/加载中/)).toBeNull();
    });
    expect(screen.queryByRole('status')).toBeNull();
  });
});