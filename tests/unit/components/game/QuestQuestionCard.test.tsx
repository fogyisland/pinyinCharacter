// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QuestQuestionCard } from '@/components/game/quest/QuestQuestionCard';
import type { QuestQuestion } from '@/lib/game-quest-types';

/**
 * The question card of the quest.
 *
 * The ② tone question carries the only 🔊 control. While the sound is muted
 * the button must **not** look live: it is disabled and says 「🔇 已静音」, so
 * the learner does not click a button that does nothing.
 */
const TONE_QUESTION: QuestQuestion = {
  kind: 'tone',
  options: ['āi', 'ái', 'ǎi', 'ài'],
  answerIndex: 3,
};

const PINYIN_QUESTION: QuestQuestion = {
  kind: 'pinyin',
  options: ['ai', 'ao', 'an', 'ang'],
  answerIndex: 0,
};

function renderCard(muted?: boolean): void {
  render(
    <QuestQuestionCard
      question={TONE_QUESTION}
      plainPinyin="ai"
      index={1}
      total={4}
      selected={null}
      answered={false}
      correct={false}
      hinted={false}
      onSelect={vi.fn()}
      onHint={vi.fn()}
      audio="idle"
      onPlayAudio={vi.fn()}
      muted={muted}
    />,
  );
}

describe('QuestQuestionCard — the audio button', () => {
  beforeEach(() => {
    cleanup();
  });

  it('is enabled and offers the audio while the sound is on', () => {
    renderCard(false);

    const button = screen.getByRole('button', { name: '🔊 听发音' });
    expect(button).not.toBeDisabled();
  });

  it('is disabled and says so while the sound is muted', () => {
    renderCard(true);

    const button = screen.getByRole('button', { name: '🔇 已静音' });
    expect(button).toBeDisabled();
    // The live-looking label is gone.
    expect(screen.queryByRole('button', { name: '🔊 听发音' })).toBeNull();
  });

  it('treats an absent muted flag as unmuted', () => {
    renderCard();

    expect(screen.getByRole('button', { name: '🔊 听发音' })).not.toBeDisabled();
    expect(screen.queryByRole('button', { name: '🔇 已静音' })).toBeNull();
  });

  it('carries no audio button on the ① question', () => {
    render(
      <QuestQuestionCard
        question={PINYIN_QUESTION}
        plainPinyin="ai"
        index={0}
        total={4}
        selected={null}
        answered={false}
        correct={false}
        hinted={false}
        onSelect={vi.fn()}
        onHint={vi.fn()}
        audio="idle"
        onPlayAudio={vi.fn()}
        muted
      />,
    );

    expect(screen.queryByRole('button', { name: /🔊/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /🔇/ })).toBeNull();
  });
});
