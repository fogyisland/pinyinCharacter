'use client';

/**
 * One option of a quest question.
 *
 * The option is **tap only** - the quest mode has no drag-and-drop anywhere.
 * The state carries the whole answer feedback:
 *
 * - `idle` — open, the learner may still pick it;
 * - `correct` — the learner picked it and it was right;
 * - `wrong` — the learner picked it and it was wrong - it carries a ✕ mark, so
 *   the miss is not carried by the colour alone (spec §7.2);
 * - `revealed` — the answer, shown after a miss;
 * - `disabled` — the question is locked and this option is not the answer.
 */
export interface QuestOptionButtonProps {
  label: string;
  state: 'idle' | 'correct' | 'wrong' | 'revealed' | 'disabled';
  onClick: () => void;
}

const STATE_CLASS: Record<QuestOptionButtonProps['state'], string> = {
  idle: 'border-ink/30 bg-paper hover:bg-paper-deep',
  correct: 'border-success bg-success/15 text-success',
  wrong: 'border-danger bg-danger/15 text-danger',
  revealed: 'border-success bg-success/10 text-success',
  disabled: 'opacity-50 pointer-events-none border-ink/20',
};

/**
 * Only the `idle` option is clickable: once the question is locked every
 * option is, and the feedback is carried by the colours and the state
 * attribute instead.
 */
export function QuestOptionButton({ label, state, onClick }: QuestOptionButtonProps) {
  return (
    <button
      type="button"
      data-state={state}
      disabled={state !== 'idle'}
      onClick={onClick}
      className={`w-full rounded border px-4 py-3 text-left transition-colors ${STATE_CLASS[state]}`}
    >
      {label}
      {state === 'wrong' ? <span className="ml-2">✕</span> : null}
    </button>
  );
}
