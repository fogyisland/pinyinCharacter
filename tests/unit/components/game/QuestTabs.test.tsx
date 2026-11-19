// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { installLocalStorageShim } from './helpers';
import { PROGRESS_KEY } from '@/lib/game-progress';

/**
 * The four panels of the game page.
 *
 * The test pins the URL contract (`?tab`, `?hsk`, `?level`) and the
 * **per-tier** level pointer: a single global pointer would lose the
 * position in the other five tiers, and that is exactly what the second
 * group of cases checks.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

/**
 * The runner is mocked: the two new cases drive the runner's pass branch and
 * its 「下一关」 button, and the real runner would need a whole board of
 * characters to reach them. The mock writes the pass to the progress store
 * the way the real runner does - that is what moves the tier's pointer.
 */
vi.mock('@/components/game/quest/QuestRunner', async () => {
  const { loadProgress, markLevelPassed, saveProgress } = await import('@/lib/game-progress');
  return {
    QuestRunner: ({
      tier,
      level,
      onPassed,
      onNextLevel,
      muted,
    }: {
      tier: number;
      level: number;
      onExit: () => void;
      onPassed: (level: number) => void;
      onNextLevel: () => void;
      muted: boolean;
    }) => (
      <div
        data-quest-runner
        data-runner-tier={tier}
        data-runner-level={level}
        data-runner-muted={String(muted)}
      >
        <button
          type="button"
          onClick={() => {
            saveProgress(markLevelPassed(loadProgress(), tier, level));
            onPassed(level);
          }}
        >
          通关本局
        </button>
        <button type="button" onClick={onNextLevel}>
          下一关
        </button>
      </div>
    ),
  };
});

/**
 * The catch-the-character game is mocked: the panel's job is only to SHOW
 * it, and the real game needs a canvas and a character pool — both of
 * which are covered by the game's own test file.
 */
vi.mock('@/components/game/CatchCharGame', () => ({
  CatchCharGame: () => <div data-catch-game />,
}));

/**
 * The idiom drag game is mocked for the same reason as the catch game: the
 * panel's job is only to SHOW it, and the game has its own test file.
 */
vi.mock('@/components/game/IdiomDragGame', () => ({
  IdiomDragGame: () => <div data-idiom-game />,
}));

/** The query string of the page under test. */
function setUrl(search: string): void {
  window.history.replaceState({}, '', `/game${search}`);
}

/** Seed the progress store with a per-tier level pointer. */
function seedProgress(current: Record<string, { level: number }>): void {
  window.localStorage.setItem(
    PROGRESS_KEY,
    JSON.stringify({
      version: 1,
      current,
      passed: {},
      streak: 0,
      bestStreak: 0,
      collected: {},
      wrong: {},
      daily: {},
      updatedAt: 0,
    }),
  );
}

/** The level map's answer - the board needs the tier's level count. */
function mockLevelCount(count = 31): void {
  vi.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({
      ok: true,
      data: { hsk: 1, level: 1, levelCount: count, tierSize: 150, skipped: 3, chars: [] },
    }),
  } as Response);
}

/** The tier the mocked runner was given. */
function runnerTier(): string | null {
  return document.querySelector('[data-quest-runner]')?.getAttribute('data-runner-tier') ?? null;
}

/** The level the mocked runner was given. */
function runnerLevel(): string | null {
  return document.querySelector('[data-quest-runner]')?.getAttribute('data-runner-level') ?? null;
}

/** The mute flag the mocked runner was given - the value that enters the chain. */
function runnerMuted(): string | null {
  return document.querySelector('[data-quest-runner]')?.getAttribute('data-runner-muted') ?? null;
}

describe('QuestTabs — the four panels', () => {
  beforeEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.resetModules();
    installLocalStorageShim();
    mockLevelCount();
  });

  it('opens the 生字本 panel for ?tab=wrong', async () => {
    setUrl('?tab=wrong');
    const { QuestTabs } = await import('@/components/game/quest/QuestTabs');
    render(<QuestTabs />);

    await waitFor(() => {
      expect(screen.getByText(/生字本还是空的/)).toBeTruthy();
    });
  });

  it('opens the 字卡册 panel for ?tab=collection', async () => {
    setUrl('?tab=collection');
    const { QuestTabs } = await import('@/components/game/quest/QuestTabs');
    render(<QuestTabs />);

    await waitFor(() => {
      expect(screen.getByText(/还没有认会的字/)).toBeTruthy();
    });
  });

  it('falls back to 闯关 for an unknown tab', async () => {
    setUrl('?tab=nonsense');
    const { QuestTabs } = await import('@/components/game/quest/QuestTabs');
    render(<QuestTabs />);

    await waitFor(() => {
      expect(document.querySelector('[data-level="1"]')).not.toBeNull();
    });
    expect(screen.queryByText(/生字本还是空的/)).toBeNull();
  });

  it('applies the tier of the URL to the shared picker', async () => {
    setUrl('?hsk=3');
    const { QuestTabs } = await import('@/components/game/quest/QuestTabs');
    render(<QuestTabs />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'HSK 3' }).getAttribute('aria-pressed')).toBe('true');
    });
    expect(screen.getByRole('button', { name: 'HSK 1' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('keeps a level pointer per tier', async () => {
    setUrl('');
    seedProgress({ '1': { level: 4 }, '2': { level: 7 } });
    const { QuestTabs } = await import('@/components/game/quest/QuestTabs');
    render(<QuestTabs />);

    // HSK 1 stands at its own level.
    await waitFor(() => {
      expect(document.querySelector('[data-level="4"]')?.getAttribute('data-state')).toBe('current');
    });

    // HSK 2 stands at its own level - a single global pointer would show 4.
    fireEvent.click(screen.getByRole('button', { name: 'HSK 2' }));

    await waitFor(() => {
      expect(document.querySelector('[data-level="7"]')?.getAttribute('data-state')).toBe('current');
    });
    expect(document.querySelector('[data-level="4"]')?.getAttribute('data-state')).toBe('available');
  });

  it('switches the panel when a tab is clicked', async () => {
    setUrl('');
    const { QuestTabs } = await import('@/components/game/quest/QuestTabs');
    render(<QuestTabs />);

    await waitFor(() => {
      expect(document.querySelector('[data-level="1"]')).not.toBeNull();
    });

    fireEvent.click(screen.getByRole('tab', { name: '字卡册' }));
    await waitFor(() => {
      expect(screen.getByText(/还没有认会的字/)).toBeTruthy();
    });
  });

  it('shows the level map error instead of a guessed board', async () => {
    setUrl('');
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ ok: false, error: { code: 'server_error' } }),
    } as Response);

    const { QuestTabs } = await import('@/components/game/quest/QuestTabs');
    render(<QuestTabs />);

    await waitFor(() => {
      expect(screen.getByText('关卡地图暂时打不开')).toBeTruthy();
    });
    expect(screen.getByRole('button', { name: '重试' })).toBeTruthy();
    expect(document.querySelector('[data-level="1"]')).toBeNull();
  });

  it('opens the level of the URL in the tier of the URL', async () => {
    setUrl('?hsk=2&level=5');
    const { QuestTabs } = await import('@/components/game/quest/QuestTabs');
    render(<QuestTabs />);

    await waitFor(() => {
      expect(document.querySelector('[data-quest-runner]')).not.toBeNull();
    });
    expect(runnerTier()).toBe('2');
    expect(runnerLevel()).toBe('5');
  });

  it('closes the runner when 「下一关」 has nowhere to go', async () => {
    // The last level of a tier has no next level: the pointer moves to 32,
    // which does not exist, and the clamp brings it back to 31. The runner
    // would then be mounted on the very same level - the same React state,
    // no re-render - so the 通关 screen with its big seal would sit on the
    // screen for good and 「下一关」 would be a button that does nothing.
    //
    // The answer: at the end of a tier 「下一关」 returns to the level map.
    setUrl('');
    seedProgress({ '1': { level: 31 } });
    const { QuestTabs } = await import('@/components/game/quest/QuestTabs');
    render(<QuestTabs />);

    await waitFor(() => {
      expect(document.querySelector('[data-level="31"]')).not.toBeNull();
    });
    fireEvent.click(document.querySelector('[data-level="31"]') as HTMLElement);

    await waitFor(() => {
      expect(document.querySelector('[data-quest-runner]')).not.toBeNull();
    });

    // The level is 通关 - the tier's pointer moves to 32, which does not exist.
    fireEvent.click(screen.getByRole('button', { name: '通关本局' }));
    fireEvent.click(screen.getByRole('button', { name: '下一关' }));

    // The runner is gone and the board is back.
    await waitFor(() => {
      expect(document.querySelector('[data-quest-runner]')).toBeNull();
    });
    expect(document.querySelector('[data-level="31"]')).not.toBeNull();
  });

  it('opens the next level when the tier has one', async () => {
    // The ordinary case: level 1 of a 31-level tier, the pointer at 1. The
    // 「下一关」 must move the runner to level 2, not close it.
    setUrl('');
    seedProgress({ '1': { level: 1 } });
    const { QuestTabs } = await import('@/components/game/quest/QuestTabs');
    render(<QuestTabs />);

    await waitFor(() => {
      expect(document.querySelector('[data-level="1"]')).not.toBeNull();
    });
    fireEvent.click(document.querySelector('[data-level="1"]') as HTMLElement);

    await waitFor(() => {
      expect(document.querySelector('[data-quest-runner]')).not.toBeNull();
    });
    expect(runnerLevel()).toBe('1');

    fireEvent.click(screen.getByRole('button', { name: '通关本局' }));
    fireEvent.click(screen.getByRole('button', { name: '下一关' }));

    await waitFor(() => {
      expect(runnerLevel()).toBe('2');
    });
    expect(document.querySelector('[data-quest-runner]')).not.toBeNull();
  });

  it('does not request the level map outside the 闯关 panel', async () => {
    setUrl('?tab=collection');
    const { QuestTabs } = await import('@/components/game/quest/QuestTabs');
    render(<QuestTabs />);

    await waitFor(() => {
      expect(screen.getByText(/还没有认会的字/)).toBeTruthy();
    });

    // The assertion is on the URL of the call, not on the spy as a whole -
    // another request would not make this case fail.
    const questCalls = vi
      .mocked(global.fetch)
      .mock.calls.filter((call) => String(call[0]).includes('/api/game/quest'));
    expect(questCalls).toHaveLength(0);
  });

  it('flips the sound toggle and hands the muted flag to the runner', async () => {
    setUrl('?level=1');
    const { QuestTabs } = await import('@/components/game/quest/QuestTabs');
    render(<QuestTabs />);

    await waitFor(() => {
      expect(document.querySelector('[data-quest-runner]')).not.toBeNull();
    });

    // The sound is on: the toggle says so and it is pressed.
    const toggle = screen.getByRole('button', { name: '🔊 声音' });
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(runnerMuted()).toBe('false');

    fireEvent.click(toggle);

    // The toggle flips: the label and the pressed state both follow.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '🔇 静音' }).getAttribute('aria-pressed')).toBe(
        'false',
      );
    });
    // The value that enters the chain is the flipped one - the runner is
    // given the muted flag, not the flag it was mounted with.
    await waitFor(() => {
      expect(runnerMuted()).toBe('true');
    });
  });

  /**
   * The 接字 panel — the catch-the-character game.
   *
   * The game is mocked: the real one needs a canvas and a character pool,
   * and the panel's job is only to SHOW it.
   */
  describe('the 接字 panel', () => {
    it('offers a 接字 tab', async () => {
      setUrl('');
      const { QuestTabs } = await import('@/components/game/quest/QuestTabs');
      render(<QuestTabs />);

      await waitFor(() => {
        expect(screen.getByRole('tab', { name: '接字' })).toBeTruthy();
      });
    });

    it('opens the 接字 panel for ?tab=catch', async () => {
      setUrl('?tab=catch');
      const { QuestTabs } = await import('@/components/game/quest/QuestTabs');
      render(<QuestTabs />);

      await waitFor(() => {
        expect(document.querySelector('[data-catch-game]')).not.toBeNull();
      });
    });

    it('switches to the 接字 panel when the tab is clicked', async () => {
      setUrl('');
      const { QuestTabs } = await import('@/components/game/quest/QuestTabs');
      render(<QuestTabs />);

      await waitFor(() => {
        expect(document.querySelector('[data-level="1"]')).not.toBeNull();
      });

      fireEvent.click(screen.getByRole('tab', { name: '接字' }));
      await waitFor(() => {
        expect(document.querySelector('[data-catch-game]')).not.toBeNull();
      });
      // The level map is gone - only one panel is shown at a time.
      expect(document.querySelector('[data-level="1"]')).toBeNull();
    });

    it('does not request the level map for the 接字 panel', async () => {
      setUrl('?tab=catch');
      const { QuestTabs } = await import('@/components/game/quest/QuestTabs');
      render(<QuestTabs />);

      await waitFor(() => {
        expect(document.querySelector('[data-catch-game]')).not.toBeNull();
      });

      const questCalls = vi
        .mocked(global.fetch)
        .mock.calls.filter((call) => String(call[0]).includes('/api/game/quest'));
      expect(questCalls).toHaveLength(0);
    });

    it('falls back to 闯关 for an unknown tab, not to 接字', async () => {
      // A broken link must land on the default panel.
      setUrl('?tab=nonsense');
      const { QuestTabs } = await import('@/components/game/quest/QuestTabs');
      render(<QuestTabs />);

      await waitFor(() => {
        expect(document.querySelector('[data-level="1"]')).not.toBeNull();
      });
      expect(document.querySelector('[data-catch-game]')).toBeNull();
    });
  });

  /**
   * The 成语 panel — the idiom drag game.
   *
   * The game is mocked: the panel's job is only to SHOW it.
   */
  describe('the 成语 panel', () => {
    it('offers a 成语 tab', async () => {
      setUrl('');
      const { QuestTabs } = await import('@/components/game/quest/QuestTabs');
      render(<QuestTabs />);

      await waitFor(() => {
        expect(screen.getByRole('tab', { name: '成语' })).toBeTruthy();
      });
    });

    it('opens the 成语 panel for ?tab=idiom', async () => {
      setUrl('?tab=idiom');
      const { QuestTabs } = await import('@/components/game/quest/QuestTabs');
      render(<QuestTabs />);

      await waitFor(() => {
        expect(document.querySelector('[data-idiom-game]')).not.toBeNull();
      });
    });

    it('switches to the 成语 panel when the tab is clicked', async () => {
      setUrl('');
      const { QuestTabs } = await import('@/components/game/quest/QuestTabs');
      render(<QuestTabs />);

      await waitFor(() => {
        expect(document.querySelector('[data-level="1"]')).not.toBeNull();
      });

      fireEvent.click(screen.getByRole('tab', { name: '成语' }));
      await waitFor(() => {
        expect(document.querySelector('[data-idiom-game]')).not.toBeNull();
      });
      expect(document.querySelector('[data-level="1"]')).toBeNull();
    });

    it('does not request the level map for the 成语 panel', async () => {
      setUrl('?tab=idiom');
      const { QuestTabs } = await import('@/components/game/quest/QuestTabs');
      render(<QuestTabs />);

      await waitFor(() => {
        expect(document.querySelector('[data-idiom-game]')).not.toBeNull();
      });

      const questCalls = vi
        .mocked(global.fetch)
        .mock.calls.filter((call) => String(call[0]).includes('/api/game/quest'));
      expect(questCalls).toHaveLength(0);
    });
  });
});
