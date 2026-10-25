'use client';

import type { CollectedChar } from '@/lib/game-progress';

/**
 * One char of the 字卡册.
 *
 * The card renders **only** from the stored snapshot - there is no fetch and
 * no per-char lookup, so a char whose content file was regenerated (or
 * deleted) still shows its pinyin, its radical and its meaning.
 *
 * Every field is read with a fallback: a hand-edited or half-written
 * localStorage may hand the renderer an entry without `meaningShort` or
 * without `hasStory`, and a degraded row must not print `undefined`.
 */
export interface CharCardProps {
  char: string;
  snapshot: CollectedChar;
}

export function CharCard({ char, snapshot }: CharCardProps) {
  const pinyin = snapshot.pinyin ?? '';
  const plainPinyin = snapshot.plainPinyin ?? '';
  const toneName = snapshot.toneName ?? '';
  const radical = snapshot.radical ?? '';
  const meaning = snapshot.meaningShort ?? '';
  const hasStory = snapshot.hasStory === true;
  const reading = pinyin || plainPinyin;

  return (
    <div className="card-paper rounded-lg p-4">
      <div className="flex items-baseline gap-2">
        <span className="font-kai text-4xl leading-none text-ink">{char}</span>
        <span data-reading="" className="text-sm text-ink-soft">
          {reading}
        </span>
        {toneName ? <span className="text-xs text-ink-faint">{toneName}</span> : null}
      </div>

      {radical ? (
        <p className="mt-1 text-xs text-ink-faint">
          部首 <span data-radical="">{radical}</span>
        </p>
      ) : null}

      {meaning ? (
        <p data-meaning="" className="mt-2 text-sm text-ink">
          {meaning}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-3 text-xs">
        <a href={`/dictionary/${char}`} className="text-seal hover:underline">
          字典
        </a>
        <a href={`/etymology/${char}`} className="text-seal hover:underline">
          字源
        </a>
        {hasStory ? (
          <a href={`/stories/${char}`} className="text-seal hover:underline">
            故事
          </a>
        ) : null}
        <a href={`/worksheet?prefill=${char}`} className="text-seal hover:underline">
          练字帖
        </a>
      </div>
    </div>
  );
}
