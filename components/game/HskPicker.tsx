'use client';

import { useDifficulty } from '@/lib/use-difficulty';
import type { HskLevel } from '@/lib/difficulty';

const HSKS: HskLevel[] = [1, 2, 3, 4, 5, 6];

/**
 * The HSK tier picker.
 *
 * Extracted from `GameModeTabs` verbatim: the same six chips, the same
 * classes, the same store. The quest mode shares the tier with the legacy
 * games, so the two pickers must not drift apart - `GameModeTabs` keeps
 * rendering its own copy until the quest tab replaces it.
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
