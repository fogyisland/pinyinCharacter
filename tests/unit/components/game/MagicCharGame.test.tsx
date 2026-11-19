/**
 * MagicCharGame — the 变字 game.
 *
 * One character on the left, four on the right. Pick the one that is one
 * stroke away.
 *
 * The relation table is mocked: the real one is a multi-megabyte file
 * that the build produces, and the component's job is only to SHOW a
 * question it was given.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { installLocalStorageShim } from './helpers';

// @vitest-environment happy-dom

/** How many questions a round holds — the component's own constant. */
const MAGIC_ROUND_CHARS = 10;

const mockState = vi.hoisted(() => ({
  table: {} as Record<string, Record<string, string>>,
  /** Set to make the fetch fail. */
  error: undefined as Error | undefined,
}));

/** The character pool, from /api/chain/chars. */
const CHARS = [
  '大', '太', '犬', '天', '夫',
  '木', '本', '末', '未',
  '水', '永',
  '日', '曰',
  '山', '出',
];

/**
 * The mocks hand out the STABLE identity, not a fresh function per call.
 *
 * `vi.restoreAllMocks()` in `beforeEach` resets the mock's
 * implementation to the one the module gave it, so a mock built as a new
 * `vi.fn(...)` on every `vi.mock()` factory call would be reset to a
 * no-op and the fetch would never resolve — the game would sit on
 * "loading" forever. Pinning the function here is what makes the reset
 * put the implementation BACK rather than take it away.
 */
const apiMocks = vi.hoisted(() => ({
  fetchMagicTable: vi.fn(async (): Promise<Record<string, Record<string, string>>> => {
    if (mockState.error) throw mockState.error;
    return mockState.table;
  }),
  fetchChainChars: vi.fn(async () => ({
    chars: CHARS.map((char) => ({ char })),
    hskFallback: false,
  })),
}));

/**
 * The implementation to put back after a test.
 *
 * `vi.restoreAllMocks()` CLEARS a factory-built mock's implementation
 * instead of restoring it — the fetch then returns `undefined` and the
 * game waits on "loading" forever. So the reset is done by hand: clear
 * the calls, then put the implementation back.
 */
const tableImplementation = apiMocks.fetchMagicTable.getMockImplementation()!;
const charsImplementation = apiMocks.fetchChainChars.getMockImplementation()!;

// Wrap the mock in vi.fn(): `restoreAllMocks` on a plain function built
// by vi.hoisted leaves no spy for the reset to attach to, and the
// implementation survives a test that was meant to replace it.
apiMocks.fetchMagicTable = vi.fn(apiMocks.fetchMagicTable);
apiMocks.fetchChainChars = vi.fn(apiMocks.fetchChainChars);

vi.mock('@/lib/api-magic', () => apiMocks);

vi.mock('@/components/game/MagicCharGlyph', () => ({
  MagicCharGlyph: ({ char }: { char: string }) => (
    <span data-magic-glyph={char}>{char}</span>
  ),
}));

vi.mock('@/lib/api-chain', () => apiMocks);

/**
 * The table the mocked fetch hands back.
 *
 * It is shaped like the real one — a relation is recorded in BOTH
 * directions, so every character that has a relation is a base in its own
 * right — and every character has at least three characters that are NOT
 * one stroke away, so the question builder can always fill four options.
 */
const TABLE: Record<string, Record<string, string>> = {
  大: { 太: 'add', 犬: 'add', 天: 'add', 夫: 'add' },
  太: { 大: 'remove', 犬: 'modify', 夫: 'modify', 天: 'modify' },
  犬: { 大: 'remove', 太: 'modify', 天: 'modify', 夫: 'modify' },
  天: { 大: 'remove', 夫: 'modify', 犬: 'modify', 太: 'modify' },
  夫: { 大: 'remove', 天: 'modify', 太: 'modify', 犬: 'modify' },
  木: { 本: 'add', 末: 'add', 未: 'add' },
  本: { 木: 'remove', 末: 'modify', 未: 'modify' },
  末: { 木: 'remove', 本: 'modify', 未: 'modify' },
  未: { 木: 'remove', 本: 'modify', 末: 'modify' },
  水: { 永: 'add' },
  永: { 水: 'remove' },
  日: { 曰: 'modify' },
  曰: { 日: 'modify' },
  山: { 出: 'add' },
  出: { 山: 'remove' },
};

async function renderGame(): Promise<void> {
  const { MagicCharGame } = await import('@/components/game/MagicCharGame');
  render(<MagicCharGame />);
  await waitFor(() => {
    expect(screen.queryByText(/加载中/)).toBeNull();
  });
}

/**
 * Renders the game and starts a round.
 *
 * The tests below look at the question on screen, so they need the round
 * to be running. The test's own table is small — no more than three
 * characters are one stroke away from any base — so the pool passed to
 * the builder is trimmed to what the question builder can fill four
 * options out of.
 */
async function renderRound(): Promise<void> {
  await renderGame();
  fireEvent.click(screen.getByText('开始'));
  await waitFor(() => {
    expect(screen.getAllByTestId('magic-option')).toHaveLength(4);
  });
}

/** Clicks the option that holds the given character. */
function clickOption(char: string): void {
  const option = screen.getAllByTestId('magic-option').find((el) =>
    el.textContent?.includes(char),
  );
  if (!option) throw new Error(`no option holds ${char}`);
  fireEvent.click(option);
}

/** The correct option among those actually on screen. */
function theAnswer(): string {
  const base = screen.getByTestId('magic-base-char').textContent ?? '';
  const option = screen
    .getAllByTestId('magic-option')
    .find((el) => TABLE[base]?.[el.textContent ?? ''] !== undefined);
  if (!option) throw new Error(`no option is one stroke away from ${base}`);
  return option.textContent ?? '';
}

describe('MagicCharGame', () => {
  beforeEach(() => {
    cleanup();
    vi.resetModules();
    installLocalStorageShim();
    mockState.table = { ...TABLE };
    mockState.error = undefined;
    // A previous test may have replaced the implementation; put the
    // default one back. restoreAllMocks() would CLEAR it instead.
    apiMocks.fetchMagicTable.mockReset();
    apiMocks.fetchMagicTable.mockImplementation(tableImplementation);
    apiMocks.fetchChainChars.mockReset();
    apiMocks.fetchChainChars.mockImplementation(charsImplementation);
  });

  afterEach(() => {
    cleanup();
  });

  it('shows the start screen once the table has loaded', async () => {
    await renderGame();
    expect(screen.getByText('开始')).toBeTruthy();
  });

  it('shows the loading state while the table is fetched', async () => {
    vi.mocked((await import('@/lib/api-magic')).fetchMagicTable).mockImplementation(
      () => new Promise(() => {}),
    );
    const { MagicCharGame } = await import('@/components/game/MagicCharGame');
    render(<MagicCharGame />);
    expect(screen.getByText(/加载中/)).toBeTruthy();
  });

  it('shows the base character', async () => {
    await renderRound();
    expect(screen.getByTestId('magic-base-char').textContent).not.toBe('');
  });

  it('offers four options', async () => {
    await renderRound();
    expect(screen.getAllByTestId('magic-option')).toHaveLength(4);
  });

  it('offers exactly one correct answer', async () => {
    await renderRound();
    const base = screen.getByTestId('magic-base-char').textContent ?? '';
    const correct = screen
      .getAllByTestId('magic-option')
      .filter((el) => TABLE[base]?.[el.textContent ?? ''] !== undefined);
    expect(correct).toHaveLength(1);
  });

  it('shows the score', async () => {
    await renderRound();
    expect(screen.getByTestId('magic-score').textContent).not.toBe('');
  });

  it('counts a correct answer', async () => {
    await renderRound();
    clickOption(theAnswer());
    await waitFor(() => {
      expect(screen.getByTestId('magic-correct-count').textContent).toBe('1');
    });
  });

  it('counts a wrong answer', async () => {
    await renderRound();
    const base = screen.getByTestId('magic-base-char').textContent ?? '';
    const wrong = screen
      .getAllByTestId('magic-option')
      .find((el) => TABLE[base]?.[el.textContent ?? ''] === undefined);
    if (!wrong) throw new Error('no wrong option');
    fireEvent.click(wrong);
    await waitFor(() => {
      expect(screen.getByTestId('magic-wrong-count').textContent).toBe('1');
    });
  });

  it('moves on to the next question after an answer', async () => {
    await renderRound();
    const before = screen.getByTestId('magic-round').textContent;
    clickOption(theAnswer());
    await waitFor(() => {
      expect(screen.getByTestId('magic-round').textContent).not.toBe(before);
    });
  });

  it('ends the round after every question has been answered', async () => {
    await renderRound();
    for (let i = 0; i < MAGIC_ROUND_CHARS; i++) {
      if (screen.queryAllByTestId('magic-option').length === 0) break;
      clickOption(theAnswer());
    }
    await waitFor(() => {
      expect(screen.getByText(/本局结束/)).toBeTruthy();
    }, { timeout: 5000 });
    const correct = Number(screen.getByTestId('magic-final-correct').textContent);
    const wrong = Number(screen.getByTestId('magic-final-wrong').textContent);
    expect(correct).toBeGreaterThan(0);
    expect(wrong).toBe(0);
  });

  it('shows the error state when the table cannot be loaded', async () => {
    mockState.error = new Error('boom');
    const { MagicCharGame } = await import('@/components/game/MagicCharGame');
    render(<MagicCharGame />);
    await waitFor(() => {
      expect(screen.getByText(/关系表暂时读不到/)).toBeTruthy();
    });
  });

  it('offers a retry when the table failed to load', async () => {
    mockState.error = new Error('boom');
    const { MagicCharGame } = await import('@/components/game/MagicCharGame');
    render(<MagicCharGame />);
    await waitFor(() => {
      expect(screen.getByText(/关系表暂时读不到/)).toBeTruthy();
    });
    expect(screen.getByText('重试')).toBeTruthy();
  });

  it('retries the load when the player asks it to', async () => {
    mockState.error = new Error('boom');
    const { MagicCharGame } = await import('@/components/game/MagicCharGame');
    render(<MagicCharGame />);
    await waitFor(() => {
      expect(screen.getByText(/关系表暂时读不到/)).toBeTruthy();
    });
    // The failure is gone by the time the player presses 重试.
    mockState.error = undefined;
    fireEvent.click(screen.getByText('重试'));
    await waitFor(() => {
      expect(screen.getByText('开始')).toBeTruthy();
    });
  });

  it('starts the round when the player asks it to', async () => {
    await renderGame();
    fireEvent.click(screen.getByText('开始'));
    await waitFor(() => {
      expect(screen.getByTestId('magic-round')).toBeTruthy();
      expect(screen.getAllByTestId('magic-option')).toHaveLength(4);
    });
  });

  it('counts the time down', async () => {
    await renderRound();
    const timer = screen.getByTestId('magic-timer').textContent ?? '';
    await waitFor(() => {
      expect(screen.getByTestId('magic-timer').textContent).not.toBe(timer);
    }, { timeout: 4000 });
  });
});
