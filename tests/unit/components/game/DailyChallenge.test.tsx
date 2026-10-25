// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { installLocalStorageShim } from './helpers';
import { loadProgress, localDateKey } from '@/lib/game-progress';

/**
 * The 每日一局 panel - the four daily slots.
 *
 * The test pins Review Focus #4: the mode, the difficulty and the HSK tier
 * are three **independent** axes, so a hard round of HSK 1 never marks the
 * easy round of HSK 2 as played.
 */

/** The score the stubbed games report - the test changes it between rounds. */
const mockState = vi.hoisted(() => ({ score: 3 }));

vi.mock('@/components/game/ToneRadicalGame', () => ({
  ToneRadicalGame: (props: {
    onComplete?: (result: { correct: number; wrong: number }) => void;
  }) => (
    <button
      type="button"
      onClick={() => props.onComplete?.({ correct: mockState.score, wrong: 1 })}
    >
      完成本局
    </button>
  ),
}));

vi.mock('@/components/game/DragMatchGame', () => ({
  DragMatchGame: (props: {
    onComplete?: (result: { correct: number; wrong: number }) => void;
  }) => (
    <button
      type="button"
      onClick={() => props.onComplete?.({ correct: mockState.score, wrong: 1 })}
    >
      完成本局
    </button>
  ),
}));

vi.mock('@/components/game/ChainGame', () => ({
  ChainGame: (props: {
    onComplete?: (result: { correct: number; wrong: number }) => void;
  }) => (
    <button
      type="button"
      onClick={() => props.onComplete?.({ correct: mockState.score, wrong: 1 })}
    >
      完成本局
    </button>
  ),
}));

/**
 * The lazily-loaded games are mocked, so the chunk never loads.
 *
 * `next/dynamic` resolves the loader to the **component itself**, so the
 * mock re-wraps it for `React.lazy`. A chunk load is asynchronous, so every
 * assertion on a rendered game has to wait for it.
 */
vi.mock('next/dynamic', async () => {
  const React = await import('react');
  type GameComponent = React.ComponentType<Record<string, unknown>>;
  return {
    default: (loader: () => Promise<GameComponent>) => {
      const Lazy = React.lazy(async () => ({ default: await loader() }));
      return function DynamicMock(props: Record<string, unknown>) {
        return (
          <React.Suspense fallback={null}>
            <Lazy {...props} />
          </React.Suspense>
        );
      };
    },
  };
});

/** One card of the panel. */
function cardOf(mode: string): HTMLElement {
  const node = document.querySelector(`[data-daily-card="${mode}"]`);
  if (!node) throw new Error(`the card ${mode} is not rendered`);
  return node as HTMLElement;
}

/** The status line of one card. */
function statusOf(mode: string): string {
  return cardOf(mode).querySelector(`[data-daily-status="${mode}"]`)?.textContent ?? '';
}

/** Open a card, wait for its game and report a finished round. */
async function playRound(mode: string): Promise<void> {
  const card = cardOf(mode);
  fireEvent.click(within(card).getByRole('button', { name: /开始|再玩一次/ }));
  await waitFor(() => {
    expect(screen.getByRole('button', { name: '完成本局' })).toBeTruthy();
  });
  fireEvent.click(screen.getByRole('button', { name: '完成本局' }));
}

describe('DailyChallenge — the daily slots', () => {
  beforeEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.resetModules();
    installLocalStorageShim();
    mockState.score = 3;
  });

  it('records only the slot of the mode, the difficulty and the tier that were played', async () => {
    const { DailyChallenge } = await import('@/components/game/daily/DailyChallenge');
    render(<DailyChallenge tier={1} difficulty="medium" />);

    await playRound('tone');

    // The card shows the result of the round that was just played.
    expect(statusOf('tone')).toContain('已完成');
    expect(statusOf('tone')).toContain('3 分');

    const today = localDateKey();
    const stored = loadProgress();
    expect(stored.daily[today]?.['tone:medium:hsk1']).toEqual({ done: true, score: 3 });
    // The other three axes are untouched.
    expect(stored.daily[today]?.['tone:medium:hsk2']).toBeUndefined();
    expect(stored.daily[today]?.['tone:hard:hsk1']).toBeUndefined();
    expect(stored.daily[today]?.['radical:medium:hsk1']).toBeUndefined();
    expect(stored.daily[today]?.['pinyin-char:medium:hsk1']).toBeUndefined();
  });

  it('shows the slot of the current tier and difficulty only (Review Focus #4)', async () => {
    const { DailyChallenge } = await import('@/components/game/daily/DailyChallenge');
    const { rerender } = render(<DailyChallenge tier={1} difficulty="medium" />);

    await playRound('tone');
    expect(statusOf('tone')).toContain('已完成');

    // Another tier - that is a different slot.
    rerender(<DailyChallenge tier={2} difficulty="medium" />);
    expect(statusOf('tone')).toBe('未玩');

    // Another difficulty - that is a different slot again.
    rerender(<DailyChallenge tier={1} difficulty="hard" />);
    expect(statusOf('tone')).toBe('未玩');

    // And back to the slot that was played.
    rerender(<DailyChallenge tier={1} difficulty="medium" />);
    expect(statusOf('tone')).toContain('已完成');
  });

  it('keeps the first result when the round is played again', async () => {
    const { DailyChallenge } = await import('@/components/game/daily/DailyChallenge');
    render(<DailyChallenge tier={1} difficulty="medium" />);

    await playRound('tone');
    expect(statusOf('tone')).toContain('3 分');

    // The card now offers a replay.
    expect(within(cardOf('tone')).getByRole('button', { name: '再玩一次' })).toBeTruthy();

    mockState.score = 9;
    await playRound('tone');

    // The second round does not overwrite the slot.
    expect(statusOf('tone')).toContain('3 分');
    expect(statusOf('tone')).not.toContain('9 分');
    expect(loadProgress().daily[localDateKey()]?.['tone:medium:hsk1']).toEqual({
      done: true,
      score: 3,
    });
  });

  it('opens one card at a time', async () => {
    const { DailyChallenge } = await import('@/components/game/daily/DailyChallenge');
    render(<DailyChallenge tier={1} difficulty="medium" />);

    fireEvent.click(within(cardOf('tone')).getByRole('button', { name: '开始' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '完成本局' })).toBeTruthy();
    });
    expect(within(cardOf('tone')).getByRole('button', { name: '结束' })).toBeTruthy();

    // Opening another card closes the first one.
    fireEvent.click(within(cardOf('radical')).getByRole('button', { name: '开始' }));
    await waitFor(() => {
      expect(within(cardOf('radical')).getByRole('button', { name: '结束' })).toBeTruthy();
    });
    expect(within(cardOf('tone')).queryByRole('button', { name: '结束' })).toBeNull();
  });
});
