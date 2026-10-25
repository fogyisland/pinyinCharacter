'use client';

import type { QuestCharPayload } from '@/lib/game-quest-types';
import { QuestSealStamp } from './QuestSealStamp';

/**
 * The char card of the quest.
 *
 * The card shows the glyph and **only** the facets the reveal rule has
 * unlocked: a hidden facet is not rendered at all - no placeholder, no `?`.
 * The legacy games use a `?` button for on-demand reveals; the quest must
 * not leak the answer, so a hidden facet is simply absent.
 */
export interface QuestCharCardProps {
  char: QuestCharPayload;
  /** Which facets may be shown right now (the §7.2 reveal rule). */
  showPinyin: boolean;
  showRadical: boolean;
  showMeaning: boolean;
  stamped: boolean;
  /**
   * The hint was used on this char. Optional: the spec (§5.5) asks for a
   * 「用过提示」 mark on the card, and the flag is the runner's to know.
   */
  hinted?: boolean;
}

export function QuestCharCard({
  char,
  showPinyin,
  showRadical,
  showMeaning,
  stamped,
  hinted = false,
}: QuestCharCardProps) {
  return (
    <div className="card-paper rounded-lg p-6 text-center">
      <div className="relative mx-auto flex h-32 w-32 items-center justify-center">
        <span className="font-kai text-7xl leading-none">{char.char}</span>
        <QuestSealStamp visible={stamped} />
      </div>

      {showPinyin ? (
        <p data-facet="pinyin" className="mt-3 text-lg text-ink">
          {char.plainPinyin}
          <span className="ml-1 text-sm text-ink-soft">{char.toneName}</span>
        </p>
      ) : null}

      {showRadical ? (
        <p data-facet="radical" className="mt-1 text-sm text-ink-soft">
          部首 {char.radical}
        </p>
      ) : null}

      {showMeaning ? (
        <p data-facet="meaning" className="mt-2 text-sm text-ink">
          {char.meaningZh}
        </p>
      ) : null}

      {hinted ? (
        <p data-hint="used" className="mt-2 text-xs text-ink-faint">
          用过提示
        </p>
      ) : null}
    </div>
  );
}
