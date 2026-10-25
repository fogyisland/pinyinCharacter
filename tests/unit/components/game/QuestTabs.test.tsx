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
});
