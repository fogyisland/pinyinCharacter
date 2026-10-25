'use client';

/**
 * The error state of the quest runner.
 *
 * The state is a dead end for the learner unless it offers a way out: a
 * `level_not_found` is **permanent** for the running server process (the tier
 * is built once per process), so the 「重试」 button can never succeed. The
 * 「返回关卡地图」 button is therefore **always** rendered - it is the way
 * back to the level map.
 *
 * The two failures of a level load live next to the component that renders
 * them, so the runner keeps its line budget.
 */

/** The failure of a level load - `canRetry` is false for the permanent ones. */
export interface QuestError {
  message: string;
  canRetry: boolean;
}

/** The level does not exist in the tier - it cannot be retried into existence. */
export const LEVEL_MISSING: QuestError = {
  message: '这一关不存在 —— 它可能已经随着字库更新而移走了',
  canRetry: false,
};

/** A transient failure - the next attempt may succeed. */
export const LOAD_FAILED: QuestError = { message: '这一关暂时打不开', canRetry: true };

export interface QuestErrorStateProps {
  /** The Chinese text shown to the learner. */
  message: string;
  /** The 「重试」 handler. */
  onRetry: () => void;
  /** The 「返回关卡地图」 handler. */
  onExit: () => void;
  /** Can the failure be retried? Defaults to true. */
  canRetry?: boolean;
}

export function QuestErrorState({
  message,
  onRetry,
  onExit,
  canRetry = true,
}: QuestErrorStateProps) {
  return (
    <div className="py-12 text-center">
      <p className="text-ink-soft">{message}</p>
      <div className="mt-3 flex items-center justify-center gap-3">
        <button
          type="button"
          onClick={onExit}
          className="rounded border border-ink/20 bg-paper px-5 py-2 text-ink-soft hover:bg-paper-deep"
        >
          返回关卡地图
        </button>
        {canRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="rounded border border-seal bg-seal px-4 py-2 text-paper-soft hover:opacity-90"
          >
            重试
          </button>
        ) : null}
      </div>
    </div>
  );
}
