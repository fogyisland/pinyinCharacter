// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QuestErrorState } from '@/components/game/quest/QuestErrorState';

/**
 * The error state of the quest runner.
 *
 * The state must always offer a way out: a `level_not_found` is permanent
 * for the running server process, so the 「重试」 button can never succeed and
 * the 「返回关卡地图」 button is the only way back to the level map.
 */
describe('QuestErrorState — the error state of the runner', () => {
  beforeEach(() => {
    cleanup();
  });

  it('offers both buttons when the failure can be retried', () => {
    render(<QuestErrorState message="这一关暂时打不开" onRetry={vi.fn()} onExit={vi.fn()} />);

    expect(screen.getByText('这一关暂时打不开')).toBeTruthy();
    expect(screen.getByRole('button', { name: '重试' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '返回关卡地图' })).toBeTruthy();
  });

  it('offers only the way back when the failure cannot be retried', () => {
    render(
      <QuestErrorState
        message="这一关不存在 —— 它可能已经随着字库更新而移走了"
        onRetry={vi.fn()}
        onExit={vi.fn()}
        canRetry={false}
      />,
    );

    expect(screen.getByText('这一关不存在 —— 它可能已经随着字库更新而移走了')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '重试' })).toBeNull();
    // The exit is always there - it is the point of the fix.
    expect(screen.getByRole('button', { name: '返回关卡地图' })).toBeTruthy();
  });

  it('calls the retry handler', () => {
    const onRetry = vi.fn();
    render(<QuestErrorState message="这一关暂时打不开" onRetry={onRetry} onExit={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: '重试' }));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('calls the exit handler', () => {
    const onExit = vi.fn();
    render(<QuestErrorState message="这一关暂时打不开" onRetry={vi.fn()} onExit={onExit} />);

    fireEvent.click(screen.getByRole('button', { name: '返回关卡地图' }));

    expect(onExit).toHaveBeenCalledTimes(1);
  });
});
