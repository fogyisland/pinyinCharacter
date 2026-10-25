// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import type { CharInfo } from '@/lib/chain-types';
import type { LegacyGameResult } from '@/components/game/LegacyGameResult';
import { installLocalStorageShim } from './helpers';

const ci = (char: string, pinyin: string): CharInfo => ({
  char,
  pinyin,
  meaning: '',
  radical: '宀',
  tone: 1,
});

const sampleChars: CharInfo[] = [
  ci('安', 'ān'),
  ci('那', 'nà'),
  ci('呢', 'ne'),
  ci('爱', 'ài'),
  ci('一', 'yī'),
];

/**
 * Simulate another browser tab changing the stored HSK level.
 *
 * `lib/use-difficulty.ts` registers a `storage` listener on the window at
 * import time and updates the shared state from it — the same path the HSK
 * chips in the tab bar take when the player picks another level. The event
 * carries `key` / `newValue`, so a plain Event with those two properties is
 * enough (and it works in happy-dom).
 */
function setHskLevelInAnotherTab(level: number): void {
  window.localStorage.setItem('pinyin_hsk_level', String(level));
  const event = new Event('storage');
  Object.defineProperty(event, 'key', { value: 'pinyin_hsk_level' });
  Object.defineProperty(event, 'newValue', { value: String(level) });
  window.dispatchEvent(event);
}

describe('ChainGame', () => {
  beforeEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.resetModules();
    // 2026-07-03: ChainGame now uses useDifficulty which reads
    // localStorage in a useEffect. happy-dom doesn't always expose a
    // usable getItem, so we install a tiny in-memory shim.
    installLocalStorageShim();
    // Make pickStarter deterministic: always pick index 0 ('安 ān', has 2 validNext)
    vi.spyOn(Math, 'random').mockReturnValue(0);
  });

  it('shows loading state initially', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(() => new Promise(() => {}));
    // Dynamic import so vi.resetModules() clears the api-chain module cache too
    const { ChainGame } = await import('@/components/game/ChainGame');
    render(<ChainGame />);
    expect(screen.getByText(/加载中/)).toBeTruthy();
  });

  it('transitions to playing with starter after fetch', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => sampleChars,
    } as Response);
    const { ChainGame } = await import('@/components/game/ChainGame');
    render(<ChainGame />);
    await waitFor(() => {
      expect(screen.queryByText(/加载中/)).toBeNull();
    });
    expect(screen.getByText(/接龙长度/)).toBeTruthy();
  });

  it('shows valid next chars in modal after loading', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => sampleChars,
    } as Response);
    const { ChainGame } = await import('@/components/game/ChainGame');
    render(<ChainGame />);
    await waitFor(() => {
      expect(screen.getByText(/可选字/)).toBeTruthy();
    });
  });

  it('grows chain when char is picked', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => sampleChars,
    } as Response);
    const { ChainGame } = await import('@/components/game/ChainGame');
    render(<ChainGame />);
    await waitFor(() => screen.getByText(/可选字/));
    fireEvent.click(screen.getByText('那'));
    await waitFor(() => {
      expect(screen.getByText(/接龙长度: 2/)).toBeTruthy();
    });
  });

  it('shows 换一条 button disabled when chain length is 1', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => sampleChars,
    } as Response);
    const { ChainGame } = await import('@/components/game/ChainGame');
    render(<ChainGame />);
    await waitFor(() => screen.getByText(/可选字/));
    const swapBtn = screen.getByText('换一条') as HTMLButtonElement;
    expect(swapBtn.disabled).toBe(true);
  });

  it('shortens chain when 换一条 is clicked', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => sampleChars,
    } as Response);
    const { ChainGame } = await import('@/components/game/ChainGame');
    render(<ChainGame />);
    await waitFor(() => screen.getByText(/可选字/));
    fireEvent.click(screen.getByText('那'));
    await waitFor(() => screen.getByText(/接龙长度: 2/));
    const swapBtn = screen.getByText('换一条') as HTMLButtonElement;
    expect(swapBtn.disabled).toBe(false);
    fireEvent.click(swapBtn);
    await waitFor(() => {
      expect(screen.getByText(/接龙长度: 1/)).toBeTruthy();
    });
  });

  it('triggers finished state when validNext is empty (dead letter)', async () => {
    // Build chars where starter has 0 valid next chars
    const deadChars: CharInfo[] = [
      ci('包', 'bāo'), // ends in o, no char starts with o
    ];
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => deadChars,
    } as Response);
    // Dynamic import so vi.resetModules() clears the api-chain module cache too
    const { ChainGame } = await import('@/components/game/ChainGame');
    render(<ChainGame />);
    // pickStarter will retry 5 times then fallback to 包
    // 包 has 0 validNext → finished
    await waitFor(() => {
      expect(screen.getByText(/接龙结束/)).toBeTruthy();
    });
  });

  it('W3: AbortController cleanup prevents setState after unmount', async () => {
    // 2026-07-04: Task 6 W3 fold-in. Use a controllable fetch mock so
    // we can resolve the fetch AFTER the component unmounts. The
    // useEffect's cleanup should call ctrl.abort() and the subsequent
    // fetch resolution should bail out via `if (ctrl.signal.aborted)
    // return;` — no React warning, no transition to playing state.
    let resolveFetch!: (value: Response) => void;
    const pendingFetch = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    vi.spyOn(global, 'fetch').mockImplementation(() => pendingFetch);
    const { ChainGame } = await import('@/components/game/ChainGame');
    const { unmount } = render(<ChainGame />);
    // Component is in loading state; fetch is pending.
    expect(screen.getByText(/加载中/)).toBeTruthy();
    // Unmount BEFORE fetch resolves → useEffect cleanup fires ctrl.abort().
    unmount();
    // Now resolve the fetch — this used to setState on unmounted component
    // (React 18 doesn't warn, but the side-effect is wasted work). The
    // AbortController guard should bail silently.
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    resolveFetch({
      ok: true,
      json: async () => sampleChars,
    } as Response);
    // Wait a microtask for the .then chain to settle.
    await new Promise((r) => setTimeout(r, 10));
    // No "startGame failed" error, no React warning about unmounted.
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  // 2026-10-25 (Task 7): the chain game reports a finished chain through
  // the optional `onComplete` prop. ChainGame has NO 放弃 button — it has
  // 换一条, which pops the last char and keeps the round alive — so there
  // is no abandon case here. The chain game has no timer either, so the
  // result carries no duration.
  describe('completion reporting (Task 7)', () => {
    it('fires onComplete once with the chain length when the chain dead-ends', async () => {
      // 包 has no valid next char — the chain is over after the starter.
      const deadChars: CharInfo[] = [ci('包', 'bāo')];
      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => deadChars,
      } as Response);
      const onComplete = vi.fn<(result: LegacyGameResult) => void>();
      const { ChainGame } = await import('@/components/game/ChainGame');
      render(<ChainGame onComplete={onComplete} />);
      await waitFor(() => {
        expect(screen.getByText(/接龙结束/)).toBeTruthy();
      });

      expect(onComplete).toHaveBeenCalledTimes(1);
      const result = onComplete.mock.calls[0]?.[0];
      expect(result?.correct).toBe(1);
      expect(result?.wrong).toBe(0);
      // The chain game has no clock — the result carries NO duration. The
      // KEY must be absent: `durationMs: undefined` would satisfy a plain
      // `toBeUndefined()` check, so the absence is what is asserted here.
      expect(result?.durationMs).toBeUndefined();
      expect(Object.keys(result!)).not.toContain('durationMs');
    });

    it('does not fire onComplete while the chain can still grow', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => sampleChars,
      } as Response);
      const onComplete = vi.fn<(result: LegacyGameResult) => void>();
      const { ChainGame } = await import('@/components/game/ChainGame');
      render(<ChainGame onComplete={onComplete} />);
      await waitFor(() => screen.getByText(/可选字/));
      fireEvent.click(screen.getByText('那'));
      await waitFor(() => {
        expect(screen.getByText(/接龙长度: 2/)).toBeTruthy();
      });
      expect(onComplete).not.toHaveBeenCalled();
    });

    it('a restarted chain reports its own length', async () => {
      // 安 → 呢 → 饿 is three long and dead-ends on 饿; after a restart the
      // chain grows to 安 → 那, which dead-ends at two. The two rounds
      // report different lengths, so a stale report cannot pass.
      const pool: CharInfo[] = [ci('安', 'ān'), ci('那', 'nà'), ci('呢', 'ne'), ci('饿', 'è')];
      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => pool,
      } as Response);
      const onComplete = vi.fn<(result: LegacyGameResult) => void>();
      const { ChainGame } = await import('@/components/game/ChainGame');
      render(<ChainGame onComplete={onComplete} />);
      await waitFor(() => screen.getByText(/可选字/));

      // Round 1: 安 → 呢 → 饿.
      fireEvent.click(screen.getByText('呢'));
      await waitFor(() => {
        expect(screen.getByText(/接龙长度: 2/)).toBeTruthy();
      });
      fireEvent.click(screen.getByText('饿'));
      await waitFor(() => {
        expect(screen.getByText(/接龙结束/)).toBeTruthy();
      });
      expect(onComplete).toHaveBeenCalledTimes(1);
      expect(onComplete.mock.calls[0]?.[0]?.correct).toBe(3);

      // Round 2: the restart guard is per ROUND, so this chain reports too.
      fireEvent.click(screen.getByText('再来一局'));
      await waitFor(() => screen.getByText(/可选字/));
      fireEvent.click(screen.getByText('那'));
      await waitFor(() => {
        expect(screen.getByText(/接龙结束/)).toBeTruthy();
      });
      expect(onComplete).toHaveBeenCalledTimes(2);
      expect(onComplete.mock.calls[1]?.[0]?.correct).toBe(2);
    });

    // 2026-10-25 (Task 7, fix round 1): the fire-once guard belongs to the
    // ROUND, not to the mount. The pool reloads whenever the HSK level or
    // the difficulty changes (the HSK chips in the tab bar, a cross-tab
    // storage event, the retry button) — and that reload starts a NEW
    // chain, which has to report its own length.
    it('a chain that follows an HSK change reports its own length', async () => {
      const pool: CharInfo[] = [ci('安', 'ān'), ci('那', 'nà'), ci('呢', 'ne'), ci('饿', 'è')];
      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => pool,
      } as Response);
      const onComplete = vi.fn<(result: LegacyGameResult) => void>();
      const { ChainGame } = await import('@/components/game/ChainGame');
      render(<ChainGame onComplete={onComplete} />);
      await waitFor(() => screen.getByText(/可选字/));

      // Round 1: 安 → 呢 → 饿, which dead-ends.
      fireEvent.click(screen.getByText('呢'));
      await waitFor(() => {
        expect(screen.getByText(/接龙长度: 2/)).toBeTruthy();
      });
      fireEvent.click(screen.getByText('饿'));
      await waitFor(() => {
        expect(screen.getByText(/接龙结束/)).toBeTruthy();
      });
      expect(onComplete).toHaveBeenCalledTimes(1);
      expect(onComplete.mock.calls[0]?.[0]?.correct).toBe(3);

      // Another tab changed the HSK level — the pool reloads and a NEW
      // chain starts. The fire-once guard must not swallow its report.
      act(() => {
        setHskLevelInAnotherTab(3);
      });
      await waitFor(() => screen.getByText(/可选字/));

      // Round 2: the same chain again.
      fireEvent.click(screen.getByText('呢'));
      await waitFor(() => {
        expect(screen.getByText(/接龙长度: 2/)).toBeTruthy();
      });
      fireEvent.click(screen.getByText('饿'));
      await waitFor(() => {
        expect(screen.getByText(/接龙结束/)).toBeTruthy();
      });

      expect(onComplete).toHaveBeenCalledTimes(2);
      expect(onComplete.mock.calls[1]?.[0]?.correct).toBe(3);
    });
  });
});
