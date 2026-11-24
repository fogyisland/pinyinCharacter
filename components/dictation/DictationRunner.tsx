'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { speak, stopSpeaking } from '@/lib/tts';
import type { DictationItem } from '@/lib/dictation';

/**
 * The classroom dictation runner.
 *
 * The screen does exactly four things — SPEAK, COUNT DOWN, REVEAL,
 * RECORD — because the student writes on paper. There is no handwriting
 * recognition and no on-screen writing: dictation is a listening activity
 * and the pen stays on the sheet.
 *
 * Two behaviours matter more than the rest:
 *
 *   1. **The word stays hidden until the reveal.** Showing it during the
 *      listening would turn dictation into copying.
 *
 *   2. **A TTS failure never stops the lesson.** The teacher can always
 *      reveal and advance by hand; a dead voice is a nuisance, not a
 *      blocked class.
 */
interface Props {
  items: DictationItem[];
  /** Seconds between items; `null` = the teacher advances by hand. */
  intervalSec?: number | null;
  /** Called when a round ends; the wrong words are handed over for a re-test. */
  onRoundEnd?: (wrong: DictationItem[]) => void;
}

/** A round over a fixed list of items. */
interface RoundState {
  items: DictationItem[];
  index: number;
  revealed: boolean;
  wrong: DictationItem[];
}

function makeRound(items: DictationItem[]): RoundState {
  return { items, index: 0, revealed: false, wrong: [] };
}

/**
 * The dictation runner.
 *
 * @param props the items, the interval and an optional round-end hook.
 */
export function DictationRunner({ items, intervalSec = null, onRoundEnd }: Props) {
  const [round, setRound] = useState<RoundState | null>(null);
  const [finished, setFinished] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The callbacks read the current round from a ref: closing over `round`
  // would speak the item from the render the timer was set in. The ref is
  // synced in an effect (never during render — react-hooks/refs).
  const roundRef = useRef<RoundState | null>(null);
  useEffect(() => {
    roundRef.current = round;
  }, [round]);

  const speakCurrent = useCallback((state: RoundState) => {
    const current = state.items[state.index];
    if (!current) return;
    setError(null);
    speak(current.word, { voice: 'female' }).catch((e: unknown) => {
      // Report it, then get out of the way: reveal/advance stay available.
      setError((e as Error).message || 'unknown');
    });
  }, []);

  const start = useCallback(() => {
    const next = makeRound(items);
    setRound(next);
    setFinished(false);
    setError(null);
    speakCurrent(next);
  }, [items, speakCurrent]);

  /** Move to the next item (or finish the round). */
  const advance = useCallback(() => {
    const state = roundRef.current;
    if (!state) return;
    const nextIndex = state.index + 1;
    if (nextIndex >= state.items.length) {
      stopSpeaking();
      setFinished(true);
      onRoundEnd?.(state.wrong);
      return;
    }
    const next = { ...state, index: nextIndex, revealed: false };
    setRound(next);
    setError(null);
    speakCurrent(next);
  }, [onRoundEnd, speakCurrent]);

  /** Mark the current item and move on. */
  const mark = useCallback(
    (isRight: boolean) => {
      const state = roundRef.current;
      if (!state) return;
      const current = state.items[state.index];
      const wrong = isRight ? state.wrong : [...state.wrong, current];
      const nextIndex = state.index + 1;
      if (nextIndex >= state.items.length) {
        stopSpeaking();
        setRound({ ...state, wrong });
        setFinished(true);
        onRoundEnd?.(wrong);
        return;
      }
      const next = { ...state, index: nextIndex, revealed: false, wrong };
      setRound(next);
      setError(null);
      speakCurrent(next);
    },
    [onRoundEnd, speakCurrent],
  );

  const reveal = useCallback(() => {
    const state = roundRef.current;
    if (!state) return;
    setRound({ ...state, revealed: true });
  }, []);

  // The countdown: in auto mode it advances after `intervalSec`; in manual
  // mode there is no timer at all, because the rhythm belongs to the
  // teacher.
  useEffect(() => {
    if (!round || finished || intervalSec === null) return;
    const timer = setTimeout(() => {
      advance();
    }, Math.max(1, intervalSec) * 1000);
    return () => clearTimeout(timer);
  }, [round, finished, intervalSec, advance]);

  // Leaving the page must stop the voice.
  useEffect(() => stopSpeaking, []);

  const restartFromWrong = useCallback(() => {
    const state = roundRef.current;
    const wrong = state?.wrong ?? [];
    if (wrong.length === 0) return;
    const next = makeRound(wrong);
    setRound(next);
    setFinished(false);
    setError(null);
    speakCurrent(next);
  }, [speakCurrent]);

  if (items.length === 0) {
    return (
      <p data-dictation-empty className="card-paper px-6 py-16 text-center leading-7 text-ink-soft">
        还没有词条：先在「出卷」里选一批字或粘贴词表。
      </p>
    );
  }

  if (finished && round) {
    return (
      <div className="card-paper space-y-5 p-6 sm:p-10">
        <h2 className="font-kai text-3xl font-semibold">本卷结束</h2>
        <p className="text-sm text-ink-soft">
          共 {round.items.length} 条，答错 {round.wrong.length} 条。
        </p>
        {round.wrong.length > 0 ? (
          <div data-testid="dictation-wrong-list" className="border-y border-ink/15 py-5">
            <h3 className="mb-3 text-sm text-ink-soft">需要再练的词</h3>
            <ul className="flex flex-wrap gap-3">
              {round.wrong.map((item, index) => (
                <li key={`${index}-${item.word}`} className="rounded bg-paper-deep px-4 py-2 font-kai text-xl">{item.word}</li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="border-y border-ink/15 py-5 text-ink-soft">本轮没有标记错词。</p>
        )}
        <div className="flex gap-2">
          {round.wrong.length > 0 ? (
            <button
              type="button"
              onClick={restartFromWrong}
              className="rounded bg-seal px-3 py-1.5 text-sm text-white hover:bg-seal/80"
            >
              用错词再出卷
            </button>
          ) : null}
          <button
            type="button"
            onClick={start}
            className="rounded border border-ink/20 px-3 py-1.5 text-sm text-ink-soft"
          >
            再来一遍
          </button>
        </div>
      </div>
    );
  }

  if (!round) {
    return (
      <div className="card-paper space-y-5 px-5 py-12 text-center sm:py-16">
        <h2 className="font-kai text-3xl">准备好纸和笔</h2>
        <p className="mx-auto max-w-md leading-7 text-ink-soft">
          本轮共 {items.length} 条。听读音，在纸上写下词语，再揭晓答案核对。
        </p>
        <p className="text-xs text-ink-faint">
          节奏：{intervalSec === null ? '手动翻条（完全由你控制）' : `每 ${intervalSec} 秒自动翻条`}
        </p>
        <button
          type="button"
          onClick={start}
          className="rounded bg-seal px-4 py-2 text-base text-white hover:bg-seal/80"
        >
          开始报听写
        </button>
      </div>
    );
  }

  const current = round.items[round.index];

  return (
    <div className="card-paper space-y-5 p-5 sm:p-8">
      <div className="flex items-center justify-between text-sm text-ink-soft">
        <span data-testid="dictation-progress" className="font-medium tabular-nums text-ink" aria-live="polite">词条进度　
          {round.index + 1} / {round.items.length}
        </span>
        <span>
          错词 {round.wrong.length} 条
        </span>
      </div>

      <div aria-live="polite" className="flex min-h-56 flex-col items-center justify-center gap-4 rounded border-y border-ink/15 bg-paper-soft px-2 py-8 text-center sm:min-h-72">
        {round.revealed ? (
          <>
            <span className="font-kai text-5xl tracking-wide sm:text-7xl">{current.word}</span>
            {current.pinyin ? <span className="text-sm text-ink-soft">{current.pinyin}</span> : null}
          </>
        ) : (
          <span className="font-kai text-2xl text-ink-soft sm:text-3xl">听读音，在纸上写词</span>
        )}
      </div>

      {error ? (
        <p role="alert" className="rounded bg-rose-50 px-3 py-2 text-xs text-rose-700">
          朗读失败：{error}。可以继续手动揭晓/翻条。
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => speakCurrent(round)}
          className="rounded border border-ink/20 px-3 py-1.5 text-sm text-ink-soft"
        >
          再读一遍
        </button>
        {round.revealed ? null : (
          <button
            type="button"
            onClick={reveal}
            className="rounded bg-seal px-3 py-1.5 text-sm text-white hover:bg-seal/80"
          >
            揭晓答案
          </button>
        )}
        {/* 对/错 are always available: the teacher often checks straight
            from the paper without revealing on screen. */}
        <button
          type="button"
          onClick={() => mark(true)}
          className="rounded bg-seal px-3 py-1.5 text-sm text-white hover:bg-seal/80"
        >
          写对了
        </button>
        <button
          type="button"
          onClick={() => mark(false)}
          className="rounded border border-seal/60 px-3 py-1.5 text-sm text-seal"
        >
          写错了
        </button>
        {intervalSec === null ? (
          <button
            type="button"
            onClick={advance}
            className="rounded border border-ink/20 px-3 py-1.5 text-sm text-ink-soft"
          >
            下一条
          </button>
        ) : null}
      </div>
    </div>
  );
}
