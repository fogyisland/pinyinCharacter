// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { HskLevel } from '@/lib/difficulty';
import type { LegacyGameResult } from '@/components/game/LegacyGameResult';
import { installLocalStorageShim } from './helpers';

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

const sampleChars = [
  {
    char: '安',
    pinyin: 'ān',
    pinyinAlt: [],
    radical: '宀',
    strokeCount: 6,
    meaningZh: 'peace',
    meaningEn: 'peace',
    unicodeCodepoint: '5B89',
    variants: [],
    hskLevel: 1,
    level: 1 as const,
  },
  {
    char: '那',
    pinyin: 'nà',
    pinyinAlt: [],
    radical: '阝',
    strokeCount: 6,
    meaningZh: 'that',
    meaningEn: 'that',
    unicodeCodepoint: '90A3',
    variants: [],
    hskLevel: 1,
    level: 1 as const,
  },
];

function mockFetchChars(json: unknown) {
  vi.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => json,
  } as Response);
}

/** The drop zones — the '→' arrow is the marker of a CharDropZone cell. */
function dropZones(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('span'))
    .filter((el) => el.textContent === '→')
    .map((el) => el.parentElement)
    .filter((el): el is HTMLElement => el !== null);
}

/** The drop zone that belongs to the given char. */
function zoneForChar(container: HTMLElement, char: string): HTMLElement {
  const zone = dropZones(container).find(
    (z) => z.querySelector('span.text-3xl')?.textContent === char,
  );
  if (!zone) throw new Error(`no drop zone for ${char}`);
  return zone;
}

/** The draggable pinyin tile that carries the given pinyin. */
function tileForPinyin(container: HTMLElement, pinyin: string): HTMLElement {
  const tile = Array.from(container.querySelectorAll<HTMLElement>('div[draggable="true"]')).find(
    (t) => t.textContent === pinyin,
  );
  if (!tile) throw new Error(`no draggable pinyin tile for ${pinyin}`);
  return tile;
}

/** Simulate a drag from the pinyin tile onto the char's drop zone. */
function dragPinyinOntoChar(container: HTMLElement, char: string, pinyin: string): void {
  const tile = tileForPinyin(container, pinyin);
  const zone = zoneForChar(container, char);
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
  fireEvent(zone, drop);
}

describe('DragMatchGame — HSK reveal wiring (Task 9)', () => {
  beforeEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.resetModules();
    installLocalStorageShim();
  });

  it('threads revealConfig to CharDropZone (HSK 1: pinyin + meaning hints visible)', async () => {
    mockState.hskLevel = 1;
    // One request: the char pool and the hskFallback flag come in the same
    // response envelope.
    mockFetchChars({
      ok: true,
      data: { chars: sampleChars, total: sampleChars.length, page: 1, pageSize: 10 },
      hskFallback: false,
    });
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
    mockFetchChars({
      ok: true,
      data: { chars: sampleChars, total: sampleChars.length, page: 1, pageSize: 10 },
      hskFallback: false,
    });
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
    // The game reads hskFallback from the same response as the characters —
    // it used to send a second request just to learn the flag.
    let callCount = 0;
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      callCount += 1;
      return {
        ok: true,
        json: async () => ({
          ok: true,
          data: { chars: sampleChars, total: sampleChars.length, page: 1, pageSize: 10 },
          hskFallback: true,
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
    expect(callCount).toBe(1);
  });

  it('does NOT render FallbackBanner when hskFallback=false', async () => {
    mockState.hskLevel = 1;
    mockFetchChars({
      ok: true,
      data: { chars: sampleChars, total: sampleChars.length, page: 1, pageSize: 10 },
      hskFallback: false,
    });
    const { DragMatchGame } = await import('@/components/game/DragMatchGame');
    render(<DragMatchGame />);
    await waitFor(() => {
      expect(screen.queryByText(/加载中/)).toBeNull();
    });
    expect(screen.queryByRole('status')).toBeNull();
  });
});

// 2026-10-25 (Task 7): the game reports a finished round through the
// optional `onComplete` prop. Giving up is NOT completing — a learner who
// abandons a round must not be recorded as having finished it, and a new
// round must still be able to report its own result.
describe('DragMatchGame — completion reporting (Task 7)', () => {
  beforeEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.resetModules();
    installLocalStorageShim();
  });

  /** The two-char pool every case of this block plays. */
  function mockPool() {
    mockState.hskLevel = 1;
    mockFetchChars({
      ok: true,
      data: { chars: sampleChars, total: sampleChars.length, page: 1, pageSize: 10 },
      hskFallback: false,
    });
  }

  it('fires onComplete once with the score when every pair is matched', async () => {
    mockPool();
    const onComplete = vi.fn<(result: LegacyGameResult) => void>();
    const { DragMatchGame } = await import('@/components/game/DragMatchGame');
    const { container } = render(<DragMatchGame onComplete={onComplete} />);
    await waitFor(() => {
      expect(screen.queryByText(/加载中/)).toBeNull();
    });

    dragPinyinOntoChar(container, '安', 'ān');
    dragPinyinOntoChar(container, '那', 'nà');

    await waitFor(() => {
      expect(screen.getByText('完成!')).toBeTruthy();
    });

    expect(onComplete).toHaveBeenCalledTimes(1);
    const result = onComplete.mock.calls[0]?.[0];
    expect(result?.correct).toBe(2);
    expect(result?.wrong).toBe(0);
    // The duration is a stat, not the score — but it is there.
    expect(typeof result?.durationMs).toBe('number');
  });

  it('does not fire onComplete when the round is abandoned', async () => {
    mockPool();
    const onComplete = vi.fn<(result: LegacyGameResult) => void>();
    const { DragMatchGame } = await import('@/components/game/DragMatchGame');
    render(<DragMatchGame onComplete={onComplete} />);
    await waitFor(() => {
      expect(screen.queryByText(/加载中/)).toBeNull();
    });

    fireEvent.click(screen.getByText('放弃'));
    expect(screen.getByText('完成!')).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('a new round after an abandoned one still reports', async () => {
    mockPool();
    const onComplete = vi.fn<(result: LegacyGameResult) => void>();
    const { DragMatchGame } = await import('@/components/game/DragMatchGame');
    const { container } = render(<DragMatchGame onComplete={onComplete} />);
    await waitFor(() => {
      expect(screen.queryByText(/加载中/)).toBeNull();
    });

    // Round 1: give up before matching anything.
    fireEvent.click(screen.getByText('放弃'));
    expect(screen.getByText('完成!')).toBeTruthy();
    expect(onComplete).not.toHaveBeenCalled();

    // Round 2: the abandon flag is per ROUND, so this round reports.
    fireEvent.click(screen.getByText('再来一局'));
    await waitFor(() => {
      expect(screen.queryByText(/加载中/)).toBeNull();
    });
    dragPinyinOntoChar(container, '安', 'ān');
    dragPinyinOntoChar(container, '那', 'nà');
    await waitFor(() => {
      expect(screen.getByText('完成!')).toBeTruthy();
    });

    expect(onComplete).toHaveBeenCalledTimes(1);
    const result = onComplete.mock.calls[0]?.[0];
    expect(result?.correct).toBe(2);
    expect(result?.wrong).toBe(0);
  });
});
