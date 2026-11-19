// @vitest-environment happy-dom
/**
 * The 听音接字 component — the canvas game itself.
 *
 * The rules are tested in `tests/unit/lib/catch-char-rules.test.ts`; this
 * file covers the React side: the panels, the stats, the wave, the catch
 * handling and the round lifecycle.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import type { CharInfo } from '@/lib/chain-types';
import { installLocalStorageShim } from './helpers';

const ci = (char: string, pinyin: string, tone: 1 | 2 | 3 | 4 = 1): CharInfo => ({
  char,
  pinyin,
  meaning: '',
  radical: '宀',
  tone,
});

/**
 * A pool with real sound neighbourhoods, so the waves have distractors
 * that actually sound like the target.
 */
const POOL: CharInfo[] = [
  ci('妈', 'mā', 1),
  ci('麻', 'má', 2),
  ci('马', 'mǎ', 3),
  ci('码', 'mǎ', 3),
  ci('骂', 'mà', 4),
  ci('猫', 'māo', 1),
  ci('毛', 'máo', 2),
  ci('鸟', 'niǎo', 3),
  ci('鱼', 'yú', 2),
  ci('雨', 'yǔ', 3),
  ci('语', 'yǔ', 3),
  ci('天', 'tiān', 1),
  ci('田', 'tián', 2),
  ci('甜', 'tián', 2),
];

function mockFetch(): void {
  vi.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({ chars: POOL, hskFallback: false }),
  } as Response);
}

/**
 * The canvas in happy-dom has no 2D context, so every drawing call has
 * to be stubbed. The stub is installed on the prototype so a component
 * that grabs the context itself is covered too.
 */
function installCanvasStub(): void {
  const noop = () => {};
  const ctx = {
    canvas: null as unknown,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
    font: '',
    textAlign: '',
    textBaseline: '',
    fillRect: noop,
    strokeRect: noop,
    clearRect: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    arc: noop,
    ellipse: noop,
    fill: noop,
    stroke: noop,
    save: noop,
    restore: noop,
    translate: noop,
    rotate: noop,
    scale: noop,
    setTransform: noop,
    fillText: noop,
    strokeText: noop,
    measureText: () => ({ width: 10 }),
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
  };
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value: () => ctx,
  });
  Object.defineProperty(HTMLCanvasElement.prototype, 'toDataURL', {
    configurable: true,
    value: () => 'data:image/png;base64,',
  });
}

/**
 * Renders the game and presses 开始, so the round is running.
 *
 * The game's phases are loading → ready (the start screen) → playing, so
 * every test that needs the canvas has to get past the start screen.
 *
 * `timeScale` runs the game faster than real time. A character takes six
 * seconds to fall at normal speed, so a round of ten would take a minute
 * of wall clock — a unit test that takes a minute is a unit test nobody
 * runs. The scale changes the game's PACE, not its behaviour.
 */
async function renderPlaying(timeScale = 1): Promise<HTMLCanvasElement> {
  const { CatchCharGame } = await import('@/components/game/CatchCharGame');
  render(<CatchCharGame timeScale={timeScale} />);
  await waitFor(() => {
    expect(screen.queryByText(/加载中/)).toBeNull();
  });
  const start = screen.getByText(/开始/);
  fireEvent.click(start);
  await waitFor(() => {
    expect(document.querySelector('canvas')).toBeTruthy();
  });
  const canvas = document.querySelector('canvas')!;
  layoutCanvas(canvas);
  return canvas;
}

/**
 * Gives the canvas a real size.
 *
 * happy-dom lays nothing out, so `getBoundingClientRect()` returns zeros.
 * The component refuses to read the pointer's position from a canvas that
 * has no width (a canvas that is not on the screen yet) — so the test has
 * to pretend the canvas is laid out.
 */
function layoutCanvas(canvas: HTMLCanvasElement): void {
  Object.defineProperty(canvas, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 624,
      bottom: 604,
      width: 624,
      height: 604,
      toJSON: () => ({}),
    }),
  });
}

/**
 * Waits until the basket has moved away from where it was.
 *
 * The basket EASES towards its target rather than jumping, so it takes a
 * few frames to travel. The wait polls on a timer instead of relying on a
 * MutationObserver: the position is published by writing the attribute
 * directly onto the canvas (the animation loop does not re-render), and
 * happy-dom's observer does not always report those writes.
 */
async function waitForBasketMove(
  canvas: HTMLCanvasElement,
  before: string | null,
): Promise<void> {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    if (canvas.getAttribute('data-basket-x') !== before) return;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
  }
  throw new Error(
    `the basket never moved: it is still at ${canvas.getAttribute('data-basket-x')}`,
  );
}

/**
 * Plays the game by chasing the target character.
 *
 * The basket follows the target bubble down the canvas, so every wave is
 * caught — which is what a perfect player does. The wait polls on a timer
 * because the animation loop publishes its state by writing attributes
 * onto the canvas (it does not re-render).
 */
async function playUntil(predicate: () => boolean, timeoutMs = 15000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    const canvas = document.querySelector('canvas');
    const target = canvas?.getAttribute('data-target-char');
    if (canvas && target) {
      const position = canvas.getAttribute(`data-bubble-${target}`);
      if (position) {
        const x = Number(position.split(',')[0]);
        // Aim at the bubble: the basket's centre has to reach the
        // bubble's column.
        fireEvent.mouseMove(canvas, { clientX: x, clientY: 300 });
      }
    }
    await act(async () => {
      await new Promise((r) => setTimeout(r, 16));
    });
  }
  throw new Error('the round never reached the expected state');
}

describe('CatchCharGame', () => {
  beforeEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.resetModules();
    installLocalStorageShim();
    installCanvasStub();
    mockFetch();
  });

  afterEach(() => {
    cleanup();
  });

  it('shows the loading state while the pool is fetched', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(() => new Promise(() => {}));
    const { CatchCharGame } = await import('@/components/game/CatchCharGame');
    render(<CatchCharGame />);
    expect(screen.getByText(/加载中/)).toBeTruthy();
  });

  it('shows a start screen before the round begins', async () => {
    const { CatchCharGame } = await import('@/components/game/CatchCharGame');
    render(<CatchCharGame />);
    await waitFor(() => {
      expect(screen.queryByText(/加载中/)).toBeNull();
    });
    expect(screen.getByText('听音接字')).toBeTruthy();
    expect(screen.getByText(/开始/)).toBeTruthy();
  });

  it('shows the target pinyin once the round has begun', async () => {
    await renderPlaying();
    // The pinyin of some character in the pool must be on screen.
    const pinyins = POOL.map((c) => c.pinyin);
    const shown = screen.getByTestId('catch-target-pinyin').textContent ?? '';
    expect(pinyins).toContain(shown.trim());
  });

  it('shows the catch and the miss counters', async () => {
    await renderPlaying();
    expect(screen.getByTestId('catch-count').textContent).toBe('0');
    expect(screen.getByTestId('catch-miss-count').textContent).toBe('0');
  });

  it('renders a canvas for the falling characters', async () => {
    const canvas = await renderPlaying();
    expect(canvas.tagName).toBe('CANVAS');
  });

  it('offers a way to hear the target again', async () => {
    await renderPlaying();
    expect(screen.getByText(/再听一遍/)).toBeTruthy();
  });

  it('moves the basket when the arrow keys are pressed', async () => {
    const canvas = await renderPlaying();
    const before = canvas.getAttribute('data-basket-x');
    act(() => {
      fireEvent.keyDown(window, { key: 'ArrowRight' });
    });
    await waitForBasketMove(canvas, before);
  });

  it('moves the basket when the mouse moves over the canvas', async () => {
    const canvas = await renderPlaying();
    layoutCanvas(canvas);
    const before = canvas.getAttribute('data-basket-x');
    act(() => {
      fireEvent.mouseMove(canvas, { clientX: 500, clientY: 300 });
    });
    await waitForBasketMove(canvas, before);
  });

  it('shows the error state when the pool cannot be loaded', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    } as Response);
    const { CatchCharGame } = await import('@/components/game/CatchCharGame');
    render(<CatchCharGame />);
    await waitFor(() => {
      expect(screen.getByText(/字库加载失败/)).toBeTruthy();
    });
  });

  it('offers a retry when the pool failed to load', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    } as Response);
    const { CatchCharGame } = await import('@/components/game/CatchCharGame');
    render(<CatchCharGame />);
    await waitFor(() => {
      expect(screen.getByText(/字库加载失败/)).toBeTruthy();
    });
    expect(screen.getByText('重试')).toBeTruthy();
  });

  /**
   * The round's own mechanics: the player catches a character, misses one,
   * and the round ends after CATCH_ROUND_CHARS attempts.
   *
   * These drive the game's state machine through the DOM, because the
   * state machine is what the player sees: the counters, the record list
   * and the summary.
   */
  describe('the round', () => {
    it('counts a catch when the target is caught', async () => {
      await renderPlaying(20);
      await playUntil(() => screen.queryByTestId('catch-count')?.textContent === '1');
      expect(screen.getByTestId('catch-count').textContent).toBe('1');
      expect(screen.getByTestId('catch-miss-count').textContent).toBe('0');
    });

    it('ends the round after every character has been attempted', async () => {
      await renderPlaying(20);
      await playUntil(() => screen.queryByText(/本局结束/) !== null);
      expect(screen.getByText(/本局结束/)).toBeTruthy();
    });

    it('reports every attempt in the summary', async () => {
      await renderPlaying(20);
      await playUntil(() => screen.queryByText(/本局结束/) !== null);
      // The summary carries both counters.
      expect(screen.getByTestId('catch-final-count')).toBeTruthy();
      expect(screen.getByTestId('catch-final-miss-count')).toBeTruthy();
      // A perfect round: the test always catches the target.
      expect(screen.getByTestId('catch-final-count').textContent).toBe('10');
      expect(screen.getByTestId('catch-final-miss-count').textContent).toBe('0');
    });

    it('offers another round after the round ends', async () => {
      await renderPlaying(20);
      await playUntil(() => screen.queryByText(/本局结束/) !== null);
      expect(screen.getByText(/再来一局/)).toBeTruthy();
    });

    it('starts a fresh round when the player asks for another', async () => {
      await renderPlaying(20);
      await playUntil(() => screen.queryByText(/本局结束/) !== null);
      fireEvent.click(screen.getByText(/再来一局/));
      await waitFor(() => {
        expect(screen.getByTestId('catch-count').textContent).toBe('0');
      });
      expect(screen.getByTestId('catch-miss-count').textContent).toBe('0');
    });
  });
});
