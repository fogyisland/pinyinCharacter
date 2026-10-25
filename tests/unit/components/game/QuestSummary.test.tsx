// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QuestSummary } from '@/components/game/quest/QuestSummary';
import type { QuestCharPayload } from '@/lib/game-quest-types';

/**
 * The end-of-level screen.
 *
 * Both branches must carry the 「返回关卡地图」 button: at the end of a tier
 * the 「下一关」 re-opens the level just passed, so the passed branch needs a
 * way back to the map as well.
 */
const CHAR_AI: QuestCharPayload = {
  char: '爱',
  pinyin: 'ài',
  plainPinyin: 'ai',
  tone: 4,
  toneName: '去声',
  radical: '爪',
  meaningZh: '对人或万物怀有深厚真挚的情谊',
  meaningShort: '怀有深厚真挚的情谊',
  hasStory: true,
  questions: [],
};

describe('QuestSummary — the end of a level', () => {
  beforeEach(() => {
    cleanup();
  });

  // The summary's seal schedules a 20 ms timer; the tree must be unmounted
  // before the environment is torn down, or the timer fires against a
  // deleted `window`.
  afterEach(() => {
    cleanup();
  });

  it('offers the way back on the passed branch', () => {
    const onExit = vi.fn();
    render(
      <QuestSummary
        tier={1}
        level={1}
        chars={[CHAR_AI]}
        missed={[]}
        passed
        onNext={vi.fn()}
        onExit={onExit}
      />,
    );

    expect(screen.getByText('通关')).toBeTruthy();
    const exit = screen.getByRole('button', { name: '返回关卡地图' });
    fireEvent.click(exit);

    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('keeps the way back on the failed branch', () => {
    const onExit = vi.fn();
    render(
      <QuestSummary
        tier={1}
        level={1}
        chars={[CHAR_AI]}
        missed={['爱']}
        passed={false}
        onNext={vi.fn()}
        onExit={onExit}
      />,
    );

    expect(screen.getByText('还差几个字')).toBeTruthy();
    const exit = screen.getByRole('button', { name: '返回关卡地图' });
    fireEvent.click(exit);

    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('offers the next level and the way back side by side on the passed branch', () => {
    render(
      <QuestSummary
        tier={1}
        level={1}
        chars={[CHAR_AI]}
        missed={[]}
        passed
        onNext={vi.fn()}
        onExit={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: '下一关' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '返回关卡地图' })).toBeTruthy();
  });
});
