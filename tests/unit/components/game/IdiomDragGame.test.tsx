// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react';

/**
 * The idiom drag game, as the player meets it.
 *
 * The API is mocked: the game is about the interaction — pick a character
 * out of the tray, drop it into a blank — and a real database would not
 * make that any more true. The rules themselves are tested in
 * `tests/unit/lib/idiom-rules.test.ts`, against the real module.
 */

const IDIOMS = [
  {
    word: '一帆风顺',
    pinyin: 'yī fān fēng shùn',
    meaning: '比喻做事顺利，没有阻碍。',
    level: 1,
    category: '处境',
  },
  {
    word: '胸有成竹',
    pinyin: 'xiōng yǒu chéng zhú',
    meaning: '比喻做事已有把握。',
    level: 1,
    category: '品格',
  },
];

vi.mock('@/lib/api-idioms', () => ({
  fetchIdioms: vi.fn(),
  __resetIdiomCache: vi.fn(),
}));

vi.mock('@/lib/game-sound', () => ({
  playChime: vi.fn(),
  playThud: vi.fn(),
  playFanfare: vi.fn(),
  playStamp: vi.fn(),
}));

import { fetchIdioms } from '@/lib/api-idioms';
import { IdiomDragGame } from '@/components/game/IdiomDragGame';

/** The tray's buttons. */
function trayButtons(): HTMLElement[] {
  const tray = screen.getByTestId('idiom-tray');
  return Array.from(tray.querySelectorAll('button'));
}

/** The board's slot buttons. */
function slotButtons(): HTMLElement[] {
  const board = screen.getByTestId('idiom-board');
  return Array.from(board.querySelectorAll('button'));
}

/** The text of every slot. */
function slotTexts(): string[] {
  return slotButtons().map((slot) => slot.textContent ?? '');
}

describe('IdiomDragGame', () => {
  beforeEach(() => {
    cleanup();
    vi.resetAllMocks();
    vi.mocked(fetchIdioms).mockResolvedValue({ idioms: IDIOMS, failed: false });
  });

  it('shows the start card once the idioms arrive', async () => {
    render(<IdiomDragGame />);
    await waitFor(() => expect(screen.getByText('成语拖字')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: '开始' })).toBeInTheDocument();
  });

  it('asks for the easy band when it loads', async () => {
    render(<IdiomDragGame />);
    await waitFor(() =>
      expect(fetchIdioms).toHaveBeenCalledWith(undefined, 1),
    );
  });

  it('asks for every level on hard, so the literary idioms are reachable', async () => {
    // The hard tier must be able to draw the level-4 idioms. A `level=3`
    // filter would leave them out of the game entirely — the twenty-odd
    // rows would sit in the database and never be played.
    render(<IdiomDragGame />);
    await waitFor(() => expect(screen.getByText('成语拖字')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('radio', { name: '超难' }));

    await waitFor(() =>
      expect(fetchIdioms).toHaveBeenCalledWith(undefined, 4),
    );
  });

  it('says so when the query failed', async () => {
    vi.mocked(fetchIdioms).mockResolvedValue({ idioms: [], failed: true });
    render(<IdiomDragGame />);
    await waitFor(() => expect(screen.getByText(/暂时读不出来/)).toBeInTheDocument());
  });

  it('says so when there are no idioms at all', async () => {
    vi.mocked(fetchIdioms).mockResolvedValue({ idioms: [], failed: false });
    render(<IdiomDragGame />);
    await waitFor(() => expect(screen.getByText(/还没有成语数据/)).toBeInTheDocument());
  });

  it('shows a tray and a board once a round starts', async () => {
    render(<IdiomDragGame />);
    await waitFor(() => expect(screen.getByText('成语拖字')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '开始' }));

    expect(screen.getByTestId('idiom-tray')).toBeInTheDocument();
    expect(screen.getByTestId('idiom-board')).toBeInTheDocument();
    expect(slotButtons()).toHaveLength(4);
  });

  it('holds one blank on easy', async () => {
    render(<IdiomDragGame />);
    await waitFor(() => expect(screen.getByText('成语拖字')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '开始' }));

    expect(slotTexts().filter((text) => text.includes('？'))).toHaveLength(1);
  });

  it('fills a blank when the right character is dropped on it', async () => {
    render(<IdiomDragGame />);
    await waitFor(() => expect(screen.getByText('成语拖字')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '开始' }));

    // Find the blank slot and the character that belongs in it.
    const slots = slotButtons();
    const blankIndex = slotTexts().findIndex((text) => text.includes('？'));
    const tray = trayButtons();
    // The blank slot's aria-label names the character it wants.
    const wanted = slots[blankIndex].getAttribute('aria-label')?.match(/需要 (\S)/)?.[1];
    const tile = tray.find((button) => button.getAttribute('aria-label')?.includes(`字 ${wanted}`));
    expect(tile).toBeDefined();

    fireEvent.click(tile!);
    fireEvent.click(slots[blankIndex]);

    expect(slotTexts()[blankIndex]).not.toContain('？');
  });

  it('refuses a wrong character and says why', async () => {
    render(<IdiomDragGame />);
    await waitFor(() => expect(screen.getByText('成语拖字')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '开始' }));

    const slots = slotButtons();
    const blankIndex = slotTexts().findIndex((text) => text.includes('？'));
    const wanted = slots[blankIndex].getAttribute('aria-label')?.match(/需要 (\S)/)?.[1];
    const wrong = trayButtons().find(
      (button) => !button.getAttribute('aria-label')?.includes(`字 ${wanted}`),
    );
    expect(wrong).toBeDefined();

    fireEvent.click(wrong!);
    fireEvent.click(slots[blankIndex]);

    expect(screen.getByText('这个字放错了地方')).toBeInTheDocument();
    expect(slotTexts()[blankIndex]).toContain('？');
  });

  it('shows the meaning when the round is won', async () => {
    render(<IdiomDragGame />);
    await waitFor(() => expect(screen.getByText('成语拖字')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '开始' }));

    // Fill every blank, one at a time.
    for (let guard = 0; guard < 4; guard++) {
      const slots = slotButtons();
      const texts = slotTexts();
      const blankIndex = texts.findIndex((text) => text.includes('？'));
      if (blankIndex === -1) break;
      const wanted = slots[blankIndex].getAttribute('aria-label')?.match(/需要 (\S)/)?.[1];
      const tile = trayButtons().find((button) =>
        button.getAttribute('aria-label')?.includes(`字 ${wanted}`),
      );
      if (!tile) break;
      fireEvent.click(tile);
      fireEvent.click(slots[blankIndex]);
    }

    await waitFor(() => expect(screen.getByText(/拼对了：/)).toBeInTheDocument());
  });
});
