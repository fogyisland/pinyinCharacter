'use client';

import { useMemo, useState } from 'react';
import type { WrongChar } from '@/lib/game-progress';
import { daysUntilDue, dueChars } from '@/lib/review-schedule';

/**
 * 今日复习 — the wrong book's queue.
 *
 * The 生字本 used to be a record: it listed every character the learner had
 * missed, offered a worksheet, and never asked about them again. A
 * character missed once and never revisited is not learned, so the book now
 * has a plan (lib/review-schedule.ts) and this panel is the plan's face.
 *
 * The card is a SELF-TEST: the character shows, the reading stays hidden
 * until 「看答案」. Showing the pinyin up front would let the learner read
 * instead of recall.
 */
export interface ReviewPanelProps {
  wrong: Record<string, WrongChar>;
  onReview: (char: string, isRight: boolean) => void;
}

/**
 * The review panel.
 *
 * @param props the wrong book and the review recorder.
 */
export function ReviewPanel({ wrong, onReview }: ReviewPanelProps) {
  // The queue is frozen when the panel mounts: re-computing it after every
  // answer would shuffle the cards under the learner's hands as the
  // schedule changes.
  const [queue] = useState<string[]>(() => dueChars(wrong, new Date()));
  const [position, setPosition] = useState(0);
  const [revealed, setRevealed] = useState(false);

  const upcoming = useMemo(() => {
    const later: Array<{ char: string; days: number }> = [];
    for (const [char, entry] of Object.entries(wrong)) {
      if (queue.includes(char)) continue;
      later.push({ char, days: daysUntilDue(entry.review, new Date()) });
    }
    later.sort((a, b) => a.days - b.days);
    return later;
  }, [wrong, queue]);

  const current = queue[position];
  const currentEntry = current ? wrong[current] : undefined;

  if (Object.keys(wrong).length === 0) {
    return <p className="py-10 text-center text-ink-faint">生字本是空的 —— 去闯关</p>;
  }

  if (!current) {
    return (
      <div className="py-8 text-center">
        <p className="text-ink-soft">今天的复习做完了 —— {queue.length} 个字都过了一遍。</p>
        {upcoming.length > 0 ? (
          <ul className="mt-4 space-y-1 text-sm text-ink-faint">
            {upcoming.slice(0, 8).map((entry) => (
              <li key={entry.char}>
                <span className="font-kai text-lg text-ink">{entry.char}</span>
                <span className="ml-2">{entry.days} 天后</span>
              </li>
            ))}
            {upcoming.length > 8 ? <li>还有 {upcoming.length - 8} 个字在排队…</li> : null}
          </ul>
        ) : null}
      </div>
    );
  }

  const reading = currentEntry?.pinyin || currentEntry?.plainPinyin || '';
  const radical = currentEntry?.radical ?? '';
  const meaning = currentEntry?.meaningShort ?? '';
  const count = currentEntry?.count ?? 0;

  function record(isRight: boolean): void {
    if (!current) return;
    onReview(current, isRight);
    setPosition((previous) => previous + 1);
    setRevealed(false);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-sm text-ink-soft">
        <span data-testid="review-count">
          今日复习 · 还剩 {queue.length - position} 字
        </span>
        <span>
          {position + 1} / {queue.length}
        </span>
      </div>

      <div className="flex min-h-[180px] flex-col items-center justify-center gap-3 rounded border border-ink/10 bg-paper-soft p-6">
        <span data-testid="review-char" className="font-kai text-6xl leading-none text-ink">
          {current}
        </span>
        {revealed ? (
          <div className="space-y-1 text-center">
            {reading ? <p className="text-base text-ink">{reading}</p> : null}
            {radical ? <p className="text-xs text-ink-faint">部首 {radical}</p> : null}
            {meaning ? <p className="max-w-md text-sm text-ink-soft">{meaning}</p> : null}
            <p className="text-xs text-ink-faint">错过 {count} 次</p>
          </div>
        ) : (
          <p className="text-xs text-ink-faint">先在心里读一遍，再看答案</p>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2">
        {revealed ? (
          <>
            <button
              type="button"
              onClick={() => record(true)}
              className="rounded bg-seal px-4 py-2 text-sm text-white hover:bg-seal/80"
            >
              记住了
            </button>
            <button
              type="button"
              onClick={() => record(false)}
              className="rounded border border-seal/60 px-4 py-2 text-sm text-seal"
            >
              没记住
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setRevealed(true)}
            className="rounded bg-seal px-4 py-2 text-sm text-white hover:bg-seal/80"
          >
            看答案
          </button>
        )}
      </div>
    </div>
  );
}
