'use client';

import type { QuestQuestion, QuestQuestionKind } from '@/lib/game-quest-types';
import { QuestOptionButton } from './QuestOptionButton';

/**
 * The question card of the quest.
 *
 * Every question is asked the same way - the prompt on top, the four options
 * in a 2×2 grid, the 提示 button and the progress dots. Only the tone
 * question carries the 🔊 control, because only the tone question plays the
 * character.
 */
export interface QuestQuestionCardProps {
  question: QuestQuestion;
  /** The char's toneless syllable, e.g. "ai" - the ② prompt renders it large. */
  plainPinyin: string;
  index: number;
  total: number;
  /** The option the learner picked, or null. */
  selected: number | null;
  /** The question is locked (answered). */
  answered: boolean;
  /** The learner answered correctly. */
  correct: boolean;
  /** The hint has been used on this question. */
  hinted: boolean;
  onSelect: (optionIndex: number) => void;
  onHint: () => void;
  /** The ② audio state - 'idle' for the other three kinds. */
  audio: 'idle' | 'loading' | 'playing' | 'unavailable';
  onPlayAudio: () => void;
  /**
   * The sound is muted. The ② audio button is then **disabled** and says
   * 「🔇 已静音」 - a button that does nothing at all is a lie.
   *
   * The flag is **required**: it pins the chain at compile time.
   */
  muted: boolean;
}

const PROMPTS: Record<QuestQuestionKind, string> = {
  pinyin: '这个字读哪个音节？',
  tone: '读第几声？',
  radical: '这个字的部首是？',
  meaning: '这个字的意思是？',
};

const AUDIO_LABELS: Record<QuestQuestionCardProps['audio'], string> = {
  idle: '🔊 听发音',
  loading: '🔊 加载中…',
  playing: '🔊 播放中',
  unavailable: '🔊 暂时不可用',
};

/**
 * The label of the audio button while the sound is muted.
 *
 * It is a separate state, not a fifth audio state: the four `AUDIO_LABELS`
 * entries describe the *request*, the mute describes the *switch*.
 */
const MUTED_LABEL = '🔇 已静音';

type OptionState = 'idle' | 'correct' | 'wrong' | 'revealed' | 'disabled';

/**
 * The option the hint removes: the last wrong option of the seeded
 * permutation, i.e. the highest index that is **not** the answer. The answer
 * itself may never be removed.
 */
function hintTargetIndex(question: QuestQuestion): number {
  for (let index = question.options.length - 1; index >= 0; index -= 1) {
    if (index !== question.answerIndex) return index;
  }
  return -1;
}

/**
 * The state of one option.
 *
 * After a miss the answer is shown in the `revealed` state, so the learner
 * sees what the right answer was without a second attempt.
 */
function optionState(
  index: number,
  question: QuestQuestion,
  selected: number | null,
  answered: boolean,
  correct: boolean,
): OptionState {
  if (!answered) return 'idle';
  if (index === question.answerIndex) return correct && selected === index ? 'correct' : 'revealed';
  if (index === selected) return 'wrong';
  return 'disabled';
}

export function QuestQuestionCard({
  question,
  plainPinyin,
  index,
  total,
  selected,
  answered,
  correct,
  hinted,
  onSelect,
  onHint,
  audio,
  onPlayAudio,
  muted,
}: QuestQuestionCardProps) {
  const removedIndex = hinted ? hintTargetIndex(question) : -1;
  const isTone = question.kind === 'tone';

  return (
    <div className="card-paper rounded-lg p-4">
      <div className="flex items-start justify-between gap-3">
        <div data-prompt={question.kind} className="text-lg text-ink">
          {isTone ? (
            <p>
              <span className="text-3xl font-semibold">{plainPinyin}</span> {PROMPTS.tone}
            </p>
          ) : (
            <p>{PROMPTS[question.kind]}</p>
          )}
        </div>
        {isTone ? (
          <button
            type="button"
            onClick={onPlayAudio}
            disabled={muted}
            className="shrink-0 rounded border border-ink/20 bg-paper px-3 py-2 text-sm text-ink-soft hover:bg-paper-deep disabled:opacity-50"
          >
            {muted ? MUTED_LABEL : AUDIO_LABELS[audio]}
          </button>
        ) : null}
      </div>

      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
        {question.options.map((label, optionIndex) => {
          if (optionIndex === removedIndex) return null;
          const state = optionState(optionIndex, question, selected, answered, correct);
          return (
            <div key={optionIndex} data-option-index={optionIndex}>
              <QuestOptionButton
                label={label}
                state={state}
                onClick={() => onSelect(optionIndex)}
              />
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex items-center justify-between">
        <button
          type="button"
          onClick={onHint}
          disabled={hinted || answered}
          className="rounded border border-ink/20 bg-paper px-3 py-2 text-sm text-ink-soft hover:bg-paper-deep disabled:opacity-50"
        >
          提示
        </button>
        <div className="flex items-center gap-1" aria-label="答题进度">
          {Array.from({ length: total }, (_, dot) => (
            <span
              key={dot}
              className={`h-2 w-2 rounded-full ${dot === index ? 'bg-seal' : 'bg-ink/15'}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
