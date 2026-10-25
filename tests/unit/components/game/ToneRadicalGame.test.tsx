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
    ready: true,
  }),
}));

const sampleRound: GameRound = {
  mode: 'tone',
  chars: [
    { char: '安', pinyin: 'ān', meaning: 'peace', radical: '宀' },
    { char: '那', pinyin: 'nà', meaning: 'that', radical: '阝' },
  ],
  charToAnswer: {
    安: { tone: 1, radical: '宀', pinyin: 'ān' },
    那: { tone: 4, radical: '阝', pinyin: 'nà' },
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

/** The query string the component actually sent to /api/game/round. */
function firstRequestedUrl(): URL {
  const call = vi.mocked(global.fetch).mock.calls[0];
  const raw = call?.[0];
  if (typeof raw !== 'string') {
    throw new Error(`expected a string URL, got ${String(raw)}`);
  }
  return new URL(raw, 'http://localhost');
}

/**
 * happy-dom localStorage shim — useDifficulty reads from localStorage in a
 * useEffect. One copy for the whole file: the shim was duplicated verbatim in
 * two describe blocks and drifted.
 *
 * The `store` map stays INSIDE this helper on purpose: every call installs a
 * fresh map, so each test starts with an empty localStorage.
 */
function installLocalStorageShim(): void {
  const store = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
      clear: () => {
        store.clear();
      },
      key: (i: number) => Array.from(store.keys())[i] ?? null,
      get length() {
        return store.size;
      },
    },
  });
}

describe('ToneRadicalGame — HSK reveal wiring (Task 8)', () => {
  beforeEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.resetModules();
    installLocalStorageShim();
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

// 2026-10-25 (Task 5): the component gained an optional `mode` prop. When it
// is set the request carries `mode=<value>`; when it is absent the parameter
// must be MISSING (not an empty string) so the server keeps its legacy
// per-seed random behavior.
describe('ToneRadicalGame — mode prop (Task 5)', () => {
  beforeEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.resetModules();
    installLocalStorageShim();
  });

  it('sends mode=tone in the query string when the prop is set', async () => {
    mockState.hskLevel = 1;
    mockFetchOnce({ ok: true, data: sampleRound, hskFallback: false });
    const { ToneRadicalGame } = await import('@/components/game/ToneRadicalGame');
    render(<ToneRadicalGame mode="tone" />);
    await waitFor(() => {
      expect(screen.queryByText(/加载中/)).toBeNull();
    });
    expect(firstRequestedUrl().searchParams.get('mode')).toBe('tone');
  });

  it('sends mode=radical in the query string when the prop is set', async () => {
    mockState.hskLevel = 1;
    mockFetchOnce({ ok: true, data: sampleRound, hskFallback: false });
    const { ToneRadicalGame } = await import('@/components/game/ToneRadicalGame');
    render(<ToneRadicalGame mode="radical" />);
    await waitFor(() => {
      expect(screen.queryByText(/加载中/)).toBeNull();
    });
    expect(firstRequestedUrl().searchParams.get('mode')).toBe('radical');
  });

  it('sends NO mode parameter when the prop is absent (legacy behavior)', async () => {
    mockState.hskLevel = 1;
    mockFetchOnce({ ok: true, data: sampleRound, hskFallback: false });
    const { ToneRadicalGame } = await import('@/components/game/ToneRadicalGame');
    render(<ToneRadicalGame />);
    await waitFor(() => {
      expect(screen.queryByText(/加载中/)).toBeNull();
    });
    const url = firstRequestedUrl();
    expect(url.searchParams.has('mode')).toBe(false);
    expect(url.search).not.toContain('mode=');
  });
});

// 2026-10-25 (Task 5 fix round 1): proves the localStorage shim is still
// per-test isolated. `installLocalStorageShim()` creates a fresh `store` map
// on every call, so the value the first test writes is gone in the next one.
// These cases render nothing, so they only need the shim — no RTL cleanup
// and no mock reset.
describe('ToneRadicalGame — localStorage shim isolation (Task 5 fix 1)', () => {
  beforeEach(() => {
    installLocalStorageShim();
  });

  it('writes a value into the shimmed localStorage', () => {
    window.localStorage.setItem('probe-key', 'probe-value');
    expect(window.localStorage.getItem('probe-key')).toBe('probe-value');
  });

  it('starts from an empty localStorage in the next test', () => {
    expect(window.localStorage.getItem('probe-key')).toBeNull();
  });
});

// 2026-10-25 (Task 6): the token bank holds ONE TOKEN PER CHAR, so two
// chars of the same tone own two identical tokens. The client therefore has
// to track the token INDEX that was used — tracking the token VALUE
// disabled both copies at once, and the round could never be finished.
const sixCharToneRound: GameRound = {
  mode: 'tone',
  chars: [
    { char: '安', pinyin: 'ān', meaning: 'peace', radical: '宀' },
    { char: '妈', pinyin: 'mā', meaning: 'mother', radical: '女' },
    { char: '那', pinyin: 'nà', meaning: 'that', radical: '阝' },
    { char: '大', pinyin: 'dà', meaning: 'big', radical: '大' },
    { char: '好', pinyin: 'hǎo', meaning: 'good', radical: '女' },
    { char: '火', pinyin: 'huǒ', meaning: 'fire', radical: '火' },
  ],
  charToAnswer: {
    安: { tone: 1, radical: '宀', pinyin: 'ān' },
    妈: { tone: 1, radical: '女', pinyin: 'mā' },
    那: { tone: 4, radical: '阝', pinyin: 'nà' },
    大: { tone: 4, radical: '大', pinyin: 'dà' },
    好: { tone: 3, radical: '女', pinyin: 'hǎo' },
    火: { tone: 3, radical: '火', pinyin: 'huǒ' },
  },
  // One token per char — the shape the server sends now. The tone-1 pair
  // (安 / 妈) owns two identical tokens.
  toneChoices: [1, 1, 4, 4, 3, 3],
  radicalChoices: ['宀', '女', '阝', '大', '女', '火'],
  pinyinChoices: ['ān', 'mā', 'nà', 'dà', 'hǎo', 'huǒ'],
};

/** The draggable tone tiles, in DOM order — the bank index order. */
function toneTiles(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>('[role="button"][aria-label^="声调 "]'),
  );
}

/** The drop slots, in DOM order — the round's char order. */
function toneSlots(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-slot="tone"]'));
}

/**
 * Simulate a real drag from a token tile onto a drop slot.
 *
 * The browser refuses to start a drag on a `draggable="false"` element, so
 * the helper honours that: a disabled tile cannot be dragged and the slot
 * stays empty. That rule is what makes the "the round can be finished" case
 * fail against the old value-keyed bookkeeping — without it the test would
 * happily drop the same tile twice and the round would look finishable.
 */
function dragTileOntoSlot(tile: HTMLElement, slot: HTMLElement): void {
  if (tile.getAttribute('draggable') !== 'true') return;
  const payload = new Map<string, string>();
  const dataTransfer = {
    setData: (format: string, data: string) => {
      payload.set(format, data);
    },
    getData: (format: string) => payload.get(format) ?? '',
  };
  const dragStart = new Event('dragstart', { bubbles: true, cancelable: true });
  Object.defineProperty(dragStart, 'dataTransfer', { value: dataTransfer });
  fireEvent(tile, dragStart);
  const drop = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(drop, 'dataTransfer', { value: dataTransfer });
  fireEvent(slot, drop);
}

describe('ToneRadicalGame — one token per char (Task 6)', () => {
  beforeEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.resetModules();
    installLocalStorageShim();
  });

  it('finishes the round when two chars share a tone', async () => {
    mockState.hskLevel = 1;
    mockFetchOnce({ ok: true, data: sixCharToneRound, hskFallback: false });
    const { ToneRadicalGame } = await import('@/components/game/ToneRadicalGame');
    const { container } = render(<ToneRadicalGame mode="tone" />);
    await waitFor(() => {
      expect(screen.queryByText(/加载中/)).toBeNull();
    });

    const tiles = toneTiles(container);
    const slots = toneSlots(container);
    expect(tiles).toHaveLength(6);
    expect(slots).toHaveLength(6);

    // Drop every char's matching tile onto its own slot. The two tone-1
    // tiles are identical, so the learner has to be able to use both.
    const usedTiles = new Set<number>();
    sixCharToneRound.chars.forEach((c, charIndex) => {
      const tone = sixCharToneRound.charToAnswer[c.char]?.tone;
      const tileIndex = tiles.findIndex(
        (tile, index) =>
          !usedTiles.has(index) && tile.getAttribute('aria-label') === `声调 ${tone}`,
      );
      expect(tileIndex).toBeGreaterThanOrEqual(0);
      usedTiles.add(tileIndex);
      const tile = tiles[tileIndex];
      const slot = slots[charIndex];
      if (!tile || !slot) throw new Error('expected a token tile and a drop slot');
      dragTileOntoSlot(tile, slot);
    });

    await waitFor(
      () => {
        expect(screen.getByText('完成!')).toBeTruthy();
      },
      { timeout: 3000 },
    );
  });

  it('disables only the token that was used, not its identical twin', async () => {
    mockState.hskLevel = 1;
    mockFetchOnce({ ok: true, data: sixCharToneRound, hskFallback: false });
    const { ToneRadicalGame } = await import('@/components/game/ToneRadicalGame');
    const { container } = render(<ToneRadicalGame mode="tone" />);
    await waitFor(() => {
      expect(screen.queryByText(/加载中/)).toBeNull();
    });

    const tiles = toneTiles(container);
    const slots = toneSlots(container);
    const toneOneTiles = tiles.filter((tile) => tile.getAttribute('aria-label') === '声调 1');
    expect(toneOneTiles).toHaveLength(2);
    const charIndex = sixCharToneRound.chars.findIndex(
      (c) => sixCharToneRound.charToAnswer[c.char]?.tone === 1,
    );
    expect(charIndex).toBeGreaterThanOrEqual(0);
    const slot = slots[charIndex];
    if (!slot) throw new Error('expected a drop slot');

    dragTileOntoSlot(toneOneTiles[0]!, slot);

    // The tile that was used is spent...
    expect(toneOneTiles[0]!.getAttribute('draggable')).toBe('false');
    // ...but its identical twin is still available.
    expect(toneOneTiles[1]!.getAttribute('draggable')).toBe('true');
  });
});
