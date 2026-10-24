// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import type { UseDifficultyReturn } from '@/lib/use-difficulty';

/**
 * The difficulty settings used to live in the hook's component state, so
 * every consumer kept its own copy. The HSK chips in `GameModeTabs` updated
 * the tab bar only — the game below kept the old level. The settings now
 * live in a small store that all consumers share.
 */
function Consumer({
  useHook,
  label,
}: {
  useHook: () => UseDifficultyReturn;
  label: string;
}) {
  const { hskLevel, ready, setHskLevel } = useHook();
  return (
    <div>
      <span data-testid={`${label}-hsk`}>{hskLevel}</span>
      <span data-testid={`${label}-ready`}>{String(ready)}</span>
      <button type="button" onClick={() => setHskLevel(4)}>
        {label}-set
      </button>
    </div>
  );
}

beforeEach(() => {
  cleanup();
  vi.resetModules();
  // happy-dom's localStorage has no clear() — install a small in-memory
  // shim like the other component tests do.
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
});

afterEach(() => {
  cleanup();
});

describe('useDifficulty', () => {
  it('reads the stored settings after the first render', async () => {
    window.localStorage.setItem('pinyin:difficulty', 'hard');
    window.localStorage.setItem('pinyin_hsk_level', '3');
    const { useDifficulty } = await import('@/lib/use-difficulty');

    render(<Consumer useHook={useDifficulty} label="a" />);

    await waitFor(() => {
      expect(screen.getByTestId('a-ready').textContent).toBe('true');
    });
    expect(screen.getByTestId('a-hsk').textContent).toBe('3');
  });

  it('shares the level between consumers', async () => {
    const { useDifficulty } = await import('@/lib/use-difficulty');

    render(
      <>
        <Consumer useHook={useDifficulty} label="a" />
        <Consumer useHook={useDifficulty} label="b" />
      </>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('a-ready').textContent).toBe('true');
    });

    fireEvent.click(screen.getByText('a-set'));

    expect(screen.getByTestId('a-hsk').textContent).toBe('4');
    expect(screen.getByTestId('b-hsk').textContent).toBe('4');
    expect(window.localStorage.getItem('pinyin_hsk_level')).toBe('4');
  });
});
