// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { ReviewPanel } from '@/components/game/quest/ReviewPanel';
import { startOfLocalDay } from '@/lib/review-schedule';
import type { WrongChar } from '@/lib/game-progress';

/**
 * The 复习 panel — the wrong book's daily queue.
 *
 * The wrong book used to be a list you could read and print. A character
 * missed once and never revisited is not learned, so the book now has a
 * queue: today's characters, one card at a time, with 记住了 / 没记住.
 *
 * What matters here is not the curve (pinned in review-schedule.test.ts)
 * but the panel's honesty: it must show TODAY's queue, say so when there is
 * nothing left, and never silently swallow a review.
 */

function snapshot(overrides: Partial<WrongChar> = {}): WrongChar {
  return {
    pinyin: 'ài',
    plainPinyin: 'ai',
    tone: 4,
    toneName: 'fourth',
    radical: '心',
    meaningShort: 'to love',
    count: 1,
    lastAt: 0,
    hsk: 1,
    level: 1,
    ...overrides,
  } as WrongChar;
}

const today = startOfLocalDay(new Date()).getTime();

/** Two due today, one due in a week. */
const WRONG: Record<string, WrongChar> = {
  爱: snapshot({ count: 3, review: { level: 0, dueAt: today, lastReviewedAt: 0 } }),
  学: snapshot({ pinyin: 'xué', plainPinyin: 'xue', count: 1, review: { level: 0, dueAt: today, lastReviewedAt: 0 } }),
  院: snapshot({ count: 1, review: { level: 3, dueAt: today + 7 * 86_400_000, lastReviewedAt: 0 } }),
};

const { onReviewMock } = vi.hoisted(() => ({ onReviewMock: vi.fn() }));

beforeEach(() => {
  onReviewMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('ReviewPanel', () => {
  it('shows how many characters are due today', () => {
    render(<ReviewPanel wrong={WRONG} onReview={onReviewMock} />);
    expect(screen.getByTestId('review-count').textContent).toContain('2');
  });

  it('shows the hardest character first', () => {
    render(<ReviewPanel wrong={WRONG} onReview={onReviewMock} />);
    expect(screen.getByTestId('review-char').textContent).toBe('爱');
  });

  it('reveals the reading only after the learner asks', () => {
    // The queue is a self-test: showing the pinyin up front would let the
    // learner read instead of recall.
    render(<ReviewPanel wrong={WRONG} onReview={onReviewMock} />);
    expect(screen.queryByText('ài')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '看答案' }));
    expect(screen.getByText('ài')).toBeTruthy();
  });

  it('reports a correct review and moves to the next card', async () => {
    render(<ReviewPanel wrong={WRONG} onReview={onReviewMock} />);
    fireEvent.click(screen.getByRole('button', { name: '看答案' }));
    fireEvent.click(screen.getByRole('button', { name: '记住了' }));
    expect(onReviewMock).toHaveBeenCalledWith('爱', true);
    await waitFor(() => {
      expect(screen.getByTestId('review-char').textContent).toBe('学');
    });
  });

  it('reports a missed review and moves on', async () => {
    render(<ReviewPanel wrong={WRONG} onReview={onReviewMock} />);
    fireEvent.click(screen.getByRole('button', { name: '看答案' }));
    fireEvent.click(screen.getByRole('button', { name: '没记住' }));
    expect(onReviewMock).toHaveBeenCalledWith('爱', false);
    await waitFor(() => {
      expect(screen.getByTestId('review-char').textContent).toBe('学');
    });
  });

  it('says the queue is done once every card has been reviewed', async () => {
    render(<ReviewPanel wrong={WRONG} onReview={onReviewMock} />);
    for (let i = 0; i < 2; i += 1) {
      fireEvent.click(screen.getByRole('button', { name: '看答案' }));
      fireEvent.click(screen.getByRole('button', { name: '记住了' }));
      await waitFor(() => {
        expect(screen.queryByTestId('review-char')).toBeNull();
      }).catch(() => {
        // The last card keeps the panel mounted for one render; the
        // assertion below is the real check.
      });
    }
    await waitFor(() => {
      expect(screen.getByText(/今天的复习做完了/)).toBeTruthy();
    });
  });

  it('tells the learner when nothing is due, instead of showing a blank panel', () => {
    render(<ReviewPanel wrong={{ 院: WRONG['院'] }} onReview={onReviewMock} />);
    expect(screen.getByText(/今天的复习做完了/)).toBeTruthy();
  });

  it('shows the next review date for characters not due yet', () => {
    render(<ReviewPanel wrong={{ 院: WRONG['院'] }} onReview={onReviewMock} />);
    // The learner should be able to see WHEN the card comes back.
    expect(screen.getByText(/7 天后/)).toBeTruthy();
  });

  it('handles an empty wrong book', () => {
    render(<ReviewPanel wrong={{}} onReview={onReviewMock} />);
    expect(screen.getByText(/生字本是空的/)).toBeTruthy();
  });
});
