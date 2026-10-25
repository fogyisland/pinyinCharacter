'use client';

import { useDifficulty } from '@/lib/use-difficulty';
import type { HskLevel } from '@/lib/difficulty';

const HSKS: HskLevel[] = [1, 2, 3, 4, 5, 6];

/**
 * The HSK tier picker.
 *
 * The one tier row of `/game`: six chips that read and write the shared
 * `useDifficulty` store, so the 闯关 ladder and the 每日一局 rounds always
 * show the same tier. It replaces the old inline chip row - there is no
 * second copy of it any more, and the two must never drift apart.
 */
export function HskPicker() {
  const { hskLevel, setHskLevel } = useDifficulty();
  return (
    <div role="group" aria-label="HSK level" className="flex gap-2 mb-3">
      {HSKS.map((lvl) => (
        <button
          key={lvl}
          type="button"
          onClick={() => setHskLevel(lvl)}
          aria-pressed={lvl === hskLevel}
          className={`rounded border px-2 py-1 text-sm ${
            lvl === hskLevel
              ? 'bg-seal text-white border-seal'
              : 'bg-paper-deep border-ink/30 hover:bg-paper'
          }`}
        >
          HSK {lvl}
        </button>
      ))}
    </div>
  );
}
