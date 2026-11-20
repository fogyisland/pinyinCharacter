// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react';

/**
 * 对韵消消, as the player meets it.
 *
 * The API is mocked: the game is about the interaction — pick a character
 * out of the tray, drop it into a blank — and a real file read would not
 * make that any more true. The rules themselves are tested in
 * `tests/unit/lib/duiyun-rules.test.ts`, against the real module.
 */

const PAIRS = [
  {
    upper: '大陆',
    lower: '长空',
    upperPinyin: ['dà', 'lù'],
    lowerPinyin: ['cháng', 'kōng'],
    rhyme: '一东',
    book: '笠翁对韵',
  },
  {
    upper: '山花',
    lower: '海树',
    upperPinyin: ['shān', 'huā'],
    lowerPinyin: ['hǎi', 'shù'],
    rhyme: '二冬',
    book: '笠翁对韵',
  },
];

vi.mock('@/lib/api-duiyun', () => ({
  fetchDuiyunPairs: vi.fn(),
  __resetDuiyunCache: vi.fn(),
}));

vi.mock('@/lib/game-sound', () => ({
  playChime: vi.fn(),
  playThud: vi.fn(),
  playFanfare: vi.fn(),
  playStamp: vi.fn(),
}));

import { fetchDuiyunPairs } from '@/lib/api-duiyun';
import { DuiYunGame } from '@/components/game/DuiYunGame';

/** The board's slot buttons. */
function slotButtons(): HTMLElement[] {
  const board = screen.getByTestId('duiyun-board');
  return Array.from(board.querySelectorAll('button'));
}

/** The text of every slot. */
function slotTexts(): string[] {
  return slotButtons().map((slot) => slot.textContent ?? '');
}

/** The tray's buttons. */
function trayButtons(): HTMLElement[] {
  const tray = screen.getByTestId('duiyun-tray');
  return Array.from(tray.querySelectorAll('button'));
}

/** Starts a round and returns the slots. */
async function startRound(): Promise<HTMLElement[]> {
  render(<DuiYunGame />);
  await waitFor(() => expect(screen.getByText('对韵消消')).toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: '开始' }));
  return slotButtons();
}

describe('DuiYunGame', () => {
  beforeEach(() => {
    cleanup();
    vi.resetAllMocks();
    vi.mocked(fetchDuiyunPairs).mockResolvedValue({ pairs: PAIRS, failed: false });
  });

  it('shows the start card once the pairs arrive', async () => {
    render(<DuiYunGame />);
    await waitFor(() => expect(screen.getByText('对韵消消')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: '开始' })).toBeInTheDocument();
  });

  it('says so when the query failed', async () => {
    vi.mocked(fetchDuiyunPairs).mockResolvedValue({ pairs: [], failed: true });
    render(<DuiYunGame />);
    await waitFor(() => expect(screen.getByText(/暂时读不出来/)).toBeInTheDocument());
  });

  it('says so when there are no pairs at all', async () => {
    vi.mocked(fetchDuiyunPairs).mockResolvedValue({ pairs: [], failed: false });
    render(<DuiYunGame />);
    await waitFor(() => expect(screen.getByText(/还没有对韵数据/)).toBeInTheDocument());
  });

  it('shows a tray and a board once a round starts', async () => {
    const slots = await startRound();
    expect(screen.getByTestId('duiyun-tray')).toBeInTheDocument();
    expect(screen.getByTestId('duiyun-board')).toBeInTheDocument();
    expect(slots.length).toBeGreaterThan(0);
  });

  it('holds one blank on easy', async () => {
    await startRound();
    expect(slotTexts().filter((text) => text.includes('？'))).toHaveLength(1);
  });

  it('shows the rhyme the couplet comes from', async () => {
    // 韵部标签是玩家要的线索 —— 没有它，这局只是一道找字的题。
    await startRound();
    expect(screen.getByText(/韵部/)).toBeInTheDocument();
  });

  it('marks each character as 平 or 仄', async () => {
    // 平仄是这个游戏的骨头：不标出来，玩家看不出「为什么这两个字是一对」。
    // 上下句都要标 —— 一个字标了、另一个字没标，玩家对不上。
    await startRound();
    const marks = screen.getAllByText(/平|仄/);
    expect(marks.length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText(/· 平/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/· 仄/).length).toBeGreaterThanOrEqual(1);
  });

  it('fills a blank when the right character is dropped on it', async () => {
    const slots = await startRound();
    const blankIndex = slotTexts().findIndex((text) => text.includes('？'));
    const wanted = slots[blankIndex]!.getAttribute('aria-label')?.match(/需要 (\S)/)?.[1];
    const tile = trayButtons().find((b) => b.getAttribute('aria-label')?.includes(`字 ${wanted}`));
    expect(tile).toBeDefined();

    fireEvent.click(tile!);
    fireEvent.click(slots[blankIndex]!);

    expect(slotTexts()[blankIndex]).not.toContain('？');
  });

  it('refuses a wrong character and says why', async () => {
    const slots = await startRound();
    const blankIndex = slotTexts().findIndex((text) => text.includes('？'));
    const wanted = slots[blankIndex]!.getAttribute('aria-label')?.match(/需要 (\S)/)?.[1];
    const wrong = trayButtons().find(
      (b) => !b.getAttribute('aria-label')?.includes(`字 ${wanted}`),
    );
    expect(wrong).toBeDefined();

    fireEvent.click(wrong!);
    fireEvent.click(slots[blankIndex]!);

    expect(screen.getByText('这个字放错了地方')).toBeInTheDocument();
    expect(slotTexts()[blankIndex]).toContain('？');
  });

  it('shows the couplet when the round is won', async () => {
    await startRound();

    for (let guard = 0; guard < 6; guard++) {
      const slots = slotButtons();
      const texts = slotTexts();
      const blankIndex = texts.findIndex((text) => text.includes('？'));
      if (blankIndex === -1) break;
      const wanted = slots[blankIndex]!.getAttribute('aria-label')?.match(/需要 (\S)/)?.[1];
      const tile = trayButtons().find((b) => b.getAttribute('aria-label')?.includes(`字 ${wanted}`));
      if (!tile) break;
      fireEvent.click(tile);
      fireEvent.click(slots[blankIndex]);
    }

    await waitFor(() => expect(screen.getByText(/拼对了：/)).toBeInTheDocument());
  });

  it('hands a character back when the player lifts it', async () => {
    // 「填错了可以点空格把字取回来」—— 这条要真的能用。
    const slots = await startRound();
    const blankIndex = slotTexts().findIndex((text) => text.includes('？'));
    const wanted = slots[blankIndex]!.getAttribute('aria-label')?.match(/需要 (\S)/)?.[1];
    const tile = trayButtons().find((b) => b.getAttribute('aria-label')?.includes(`字 ${wanted}`));
    fireEvent.click(tile!);
    fireEvent.click(slots[blankIndex]!);
    expect(slotTexts()[blankIndex]).not.toContain('？');

    // 再点一次这一格 —— 字应该回到字盘上。
    fireEvent.click(slots[blankIndex]!);
    expect(slotTexts()[blankIndex]).toContain('？');
    expect(trayButtons().some((b) => b.getAttribute('aria-label')?.includes(`字 ${wanted}`))).toBe(true);
  });

  it('counts the blanks that are still open', async () => {
    await startRound();
    expect(screen.getByText(/还剩 1 个空/)).toBeInTheDocument();
  });

  it('lowers the blank count as the player fills the blanks', async () => {
    // 数字要跟着空走 —— 一直停在 1 的话，玩家不知道自己填了几个。
    const slots = await startRound();
    expect(screen.getByText(/还剩 1 个空/)).toBeInTheDocument();

    const blankIndex = slotTexts().findIndex((text) => text.includes('？'));
    const wanted = slots[blankIndex]!.getAttribute('aria-label')?.match(/需要 (\S)/)?.[1];
    const tile = trayButtons().find((b) => b.getAttribute('aria-label')?.includes(`字 ${wanted}`));
    fireEvent.click(tile!);
    fireEvent.click(slots[blankIndex]!);

    expect(screen.getByText(/还剩 0 个空/)).toBeInTheDocument();
  });

  it('offers another couplet after the round is won', async () => {
    await startRound();
    for (let guard = 0; guard < 6; guard++) {
      const slots = slotButtons();
      const texts = slotTexts();
      const blankIndex = texts.findIndex((text) => text.includes('？'));
      if (blankIndex === -1) break;
      const wanted = slots[blankIndex]!.getAttribute('aria-label')?.match(/需要 (\S)/)?.[1];
      const tile = trayButtons().find((b) => b.getAttribute('aria-label')?.includes(`字 ${wanted}`));
      if (!tile) break;
      fireEvent.click(tile);
      fireEvent.click(slots[blankIndex]);
    }
    await waitFor(() => expect(screen.getByText(/拼对了：/)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: '再来一副' })).toBeInTheDocument();
  });

  it('draws a different couplet for the next round', async () => {
    await startRound();
    const first = slotButtons().map((b) => b.textContent).join('');
    for (let guard = 0; guard < 6; guard++) {
      const slots = slotButtons();
      const texts = slotTexts();
      const blankIndex = texts.findIndex((text) => text.includes('？'));
      if (blankIndex === -1) break;
      const wanted = slots[blankIndex]!.getAttribute('aria-label')?.match(/需要 (\S)/)?.[1];
      const tile = trayButtons().find((b) => b.getAttribute('aria-label')?.includes(`字 ${wanted}`));
      if (!tile) break;
      fireEvent.click(tile);
      fireEvent.click(slots[blankIndex]);
    }
    await waitFor(() => expect(screen.getByText(/拼对了：/)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: '再来一副' }));
    const second = slotButtons().map((b) => b.textContent).join('');
    // 每一局都该换一副对联 —— 一直抽同一副的话，玩家玩两局就没得玩了。
    expect(second).not.toBe(first);
  });

  it('fills the blank when the tile and the slot are clicked in one go', async () => {
    // 真机走查抓到的坑：玩家点一下字、再点一下空格，这两次点击在浏览器里
    // 是同一个任务里的两件事，React 会把它们合并成一次渲染。
    // 于是空格那个按钮的 onClick 拿到的还是「点字之前」的闭包 ——
    // selectedTileId 还是空的，点下去什么也不会发生。
    //
    // fireEvent.click 每一次都自带一次 act()（每次都刷一遍渲染），
    // 所以用 fireEvent 写的用例永远抓不到这个坑 —— 必须在同一个
    // act() 里连点两次，才和真机一样。
    render(<DuiYunGame />);
    const tiles = () => Array.from(screen.getByTestId('duiyun-tray').querySelectorAll('button'));
    const slots = () => Array.from(screen.getByTestId('duiyun-board').querySelectorAll('button'));

    // 等语料到了、开始卡出现。
    await waitFor(() => expect(screen.getByRole('button', { name: '开始' })).toBeInTheDocument());
    act(() => {
      screen.getByRole('button', { name: '开始' }).click();
    });

    const slot = slots()[0]!;
    const wanted = slot.getAttribute('aria-label')?.match(/需要 (\S)/)?.[1];
    const tile = tiles().find((b) => b.getAttribute('aria-label')?.includes(`字 ${wanted}`))!;

    // 同一次 act 里连点两下 —— 这就是浏览器的 batching。
    act(() => {
      tile.click();
      slot.click();
    });

    expect(slot.textContent).not.toContain('？');
  });

  it('holds three blanks on hard', async () => {
    render(<DuiYunGame />);
    await waitFor(() => expect(screen.getByText('对韵消消')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('radio', { name: '超难' }));
    fireEvent.click(screen.getByRole('button', { name: '开始' }));

    // 两字的对句一共有四个位置 —— 挖三个正好两边都挖到。
    expect(slotTexts().filter((text) => text.includes('？'))).toHaveLength(3);
    expect(screen.getByText(/还剩 3 个空/)).toBeInTheDocument();
  });
});
