// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { installLocalStorageShim } from './helpers';
import type { CollectedChar, WrongChar } from '@/lib/game-progress';

/**
 * The three panels the runner test never reaches: the level map, the 生字本
 * and the 字卡册.
 *
 * They pin Review Focus #1 (a stale level pointer), #2 (the 500-char cap on
 * 一键生成字帖) and #3 (a snapshot that outlives its content file).
 */
const routerMock = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => routerMock,
}));

/** A wrong-book entry: the char is the record's key, the snapshot is the value. */
function wrongEntry(char: string, index: number): WrongChar {
  return {
    pinyin: 'ài',
    plainPinyin: 'ai',
    tone: 4,
    toneName: '去声',
    radical: '爪',
    meaningShort: '怀有深厚真挚的情谊',
    count: index + 1,
    lastAt: index,
    hsk: 1,
    level: 1,
  };
}

/** 520 distinct CJK ideographs - more than the worksheet API accepts. */
function bigWrongBook(): Record<string, WrongChar> {
  const wrong: Record<string, WrongChar> = {};
  for (let index = 0; index < 520; index += 1) {
    const char = String.fromCodePoint(0x4e00 + index);
    wrong[char] = wrongEntry(char, index);
  }
  return wrong;
}

async function signIn(): Promise<void> {
  const { useAppStore } = await import('@/lib/store');
  useAppStore.setState({ user: { id: 1, username: 'tester' } });
}

describe('QuestPanels — the level map, the 生字本 and the 字卡册', () => {
  beforeEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.resetModules();
    installLocalStorageShim();
    routerMock.push.mockClear();
    routerMock.replace.mockClear();
  });

  it('clamps a stale level pointer to the tier (Review Focus #1)', async () => {
    const { QuestBoard } = await import('@/components/game/quest/QuestBoard');
    const { container } = render(
      <QuestBoard
        tier={1}
        levelCount={31}
        currentLevel={999}
        passedLevels={[]}
        onOpenLevel={vi.fn()}
      />,
    );

    const tiles = container.querySelectorAll('[data-level]');
    expect(tiles).toHaveLength(31);
    // The 31st tile carries the 当前 state - there is no 32nd tile.
    expect(tiles[30].getAttribute('data-state')).toBe('current');
    expect(container.querySelector('[data-level="32"]')).toBeNull();
  });

  it('keeps the startable tiles startable and locks the rest (Review Focus #1)', async () => {
    const onOpenLevel = vi.fn();
    const { QuestBoard } = await import('@/components/game/quest/QuestBoard');
    const { container } = render(
      <QuestBoard
        tier={1}
        levelCount={31}
        currentLevel={5}
        passedLevels={[]}
        onOpenLevel={onOpenLevel}
      />,
    );

    for (let level = 1; level <= 5; level += 1) {
      const tile = container.querySelector(`[data-level="${level}"]`);
      expect(tile?.tagName).toBe('BUTTON');
    }
    const locked = container.querySelector('[data-level="6"]');
    expect(locked?.getAttribute('data-state')).toBe('locked');
    expect(locked?.tagName).not.toBe('BUTTON');

    // A locked tile cannot be opened.
    fireEvent.click(locked as Element);
    expect(onOpenLevel).not.toHaveBeenCalled();

    fireEvent.click(container.querySelector('[data-level="3"]') as Element);
    expect(onOpenLevel).toHaveBeenCalledWith(3);
  });

  it('sends only the first 500 chars to the worksheet API (Review Focus #2)', async () => {
    await signIn();
    const wrong = bigWrongBook();
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, data: { id: 7 } }),
    } as Response);

    const { WrongBook } = await import('@/components/game/quest/WrongBook');
    render(<WrongBook wrong={wrong} onRemove={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: '一键生成字帖' }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });

    const init = fetchMock.mock.calls[0]?.[1];
    const body = JSON.parse(String(init?.body)) as {
      title: string;
      content: string[];
      cellStyle: string;
      paperSize: string;
      fontFamily: string;
    };
    expect(body.content).toHaveLength(500);
    // The first 500 in the book's order.
    expect(body.content[0]).toBe(String.fromCodePoint(0x4e00));
    expect(body.content[499]).toBe(String.fromCodePoint(0x4e00 + 499));
    expect(body.title).toBe('生字本练习');
    expect(body.cellStyle).toBe('brush-square');
    expect(body.paperSize).toBe('A4');
    expect(body.fontFamily).toBe('kai');

    expect(screen.getByText('本次生成前 500 字')).toBeTruthy();

    // The remaining 20 chars are still listed, with their own 练字帖 link.
    const last = String.fromCodePoint(0x4e00 + 519);
    const row = document.querySelector(`[data-char="${last}"]`);
    expect(row).not.toBeNull();
    const link = row?.querySelector('a[href*="prefill="]');
    expect(link?.getAttribute('href')).toBe(`/worksheet?prefill=${last}`);
  });

  it('hints at the login instead of generating a worksheet for a guest', async () => {
    const fetchMock = vi.spyOn(global, 'fetch');
    const { WrongBook } = await import('@/components/game/quest/WrongBook');
    render(<WrongBook wrong={{ 爱: wrongEntry('爱', 0) }} onRemove={vi.fn()} />);

    expect(screen.getByText('登录后可一键生成字帖')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '一键生成字帖' })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('renders a collected char from its snapshot, without a request (Review Focus #3)', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockRejectedValue(new Error('offline'));
    const collected: Record<string, CollectedChar> = {
      爱: {
        pinyin: 'ài',
        plainPinyin: 'ai',
        tone: 4,
        toneName: '去声',
        radical: '爪',
        meaningShort: '怀有深厚真挚的情谊',
        hasStory: true,
        hsk: 1,
        level: 1,
        at: 1,
      },
    };

    const { CharCollection } = await import('@/components/game/quest/CharCollection');
    const { container } = render(
      <CharCollection collected={collected} onFilterTierChange={vi.fn()} />,
    );

    expect(container.querySelector('[data-reading]')?.textContent).toBe('ài');
    expect(container.querySelector('[data-radical]')?.textContent).toBe('爪');
    expect(container.querySelector('[data-meaning]')?.textContent).toBe('怀有深厚真挚的情谊');
    // The snapshot outlives its content file - no lookup, no request.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows the story link only when the snapshot carries the flag', async () => {
    const base = {
      pinyin: 'ài',
      plainPinyin: 'ai',
      tone: 4 as const,
      toneName: '去声',
      radical: '爪',
      meaningShort: '怀有深厚真挚的情谊',
      hsk: 1,
      level: 1,
      at: 1,
    };
    const { CharCollection } = await import('@/components/game/quest/CharCollection');
    const { container, unmount } = render(
      <CharCollection
        collected={{ 爱: { ...base, hasStory: true }, 好: { ...base, hasStory: false } }}
        onFilterTierChange={vi.fn()}
      />,
    );

    const storyLinks = container.querySelectorAll('a[href="/stories/爱"]');
    expect(storyLinks).toHaveLength(1);
    expect(container.querySelector('a[href="/stories/好"]')).toBeNull();
    unmount();
  });

  it('points the 练字帖 link at the worksheet generator', async () => {
    const { CharCollection } = await import('@/components/game/quest/CharCollection');
    const { container } = render(
      <CharCollection
        collected={{
          爱: {
            pinyin: 'ài',
            plainPinyin: 'ai',
            tone: 4,
            toneName: '去声',
            radical: '爪',
            meaningShort: '怀有深厚真挚的情谊',
            hasStory: false,
            hsk: 1,
            level: 1,
            at: 1,
          },
        }}
        onFilterTierChange={vi.fn()}
      />,
    );

    const link = container.querySelector('a[href*="prefill="]');
    expect(link?.getAttribute('href')).toBe('/worksheet?prefill=爱');
  });

  it('degrades a partial entry instead of rendering undefined', async () => {
    const { WrongBook } = await import('@/components/game/quest/WrongBook');
    const partial = { pinyin: 'ài' } as unknown as WrongChar;
    const { container } = render(<WrongBook wrong={{ 爱: partial }} onRemove={vi.fn()} />);

    expect(container.textContent).not.toContain('undefined');
    expect(container.textContent).not.toContain('NaN');
    // The 再练一次 link falls back to a sane tier and level.
    const again = container.querySelector('a[href*="tab=quest"]');
    expect(again?.getAttribute('href')).toBe('/game?tab=quest&hsk=1&level=1');
  });

  it('calls onRemove when a row is dropped from the 生字本', async () => {
    const onRemove = vi.fn();
    const { WrongBook } = await import('@/components/game/quest/WrongBook');
    render(<WrongBook wrong={{ 爱: wrongEntry('爱', 0) }} onRemove={onRemove} />);

    fireEvent.click(screen.getByRole('button', { name: '移出生字本' }));
    expect(onRemove).toHaveBeenCalledWith('爱');
  });
});
