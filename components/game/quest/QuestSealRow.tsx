'use client';

import type { QuestCharPayload } from '@/lib/game-quest-types';

/**
 * The level row of seals (spec §7.2).
 *
 * One small seal per char of the level: 「通」 on the chars the learner has
 * 认会, an empty faint square on the others. It is the level's progress at a
 * glance - the 4-dot row of the question card tracks the **current char**,
 * this row tracks the **level**.
 *
 * The seals are small on purpose: `QuestSealStamp` is the large stamp over
 * the glyph of the char card and the big mark on the 通关 screen.
 */
export interface QuestSealRowProps {
  chars: QuestCharPayload[];
  /** The chars whose four questions are all correct. */
  mastered: Record<string, boolean>;
}

export function QuestSealRow({ chars, mastered }: QuestSealRowProps) {
  return (
    <div className="mb-3 flex flex-wrap gap-1.5" aria-label="本关进度">
      {chars.map((char) => {
        const isMastered = mastered[char.char] === true;
        return (
          <span
            key={char.char}
            data-seal-row=""
            data-mastered={isMastered ? 'true' : 'false'}
            className={`-rotate-6 flex h-6 w-6 items-center justify-center rounded border font-kai text-xs ${
              isMastered ? 'border-seal bg-seal text-paper-soft' : 'border-ink/15 bg-paper-deep'
            }`}
          >
            {isMastered ? '通' : ''}
          </span>
        );
      })}
    </div>
  );
}
