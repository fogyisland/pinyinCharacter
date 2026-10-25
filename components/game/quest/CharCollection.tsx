'use client';

import { useState } from 'react';
import type { CollectedChar } from '@/lib/game-progress';
import { CharCard } from './CharCard';

/**
 * The 字卡册 - every char the learner has 认会.
 *
 * The filter row narrows the book by HSK tier. The tier is also reported to
 * the page, so the quest tab and the book can share one tier.
 */
export interface CharCollectionProps {
  collected: Record<string, CollectedChar>;
  onFilterTierChange: (tier: number | null) => void;
}

export function CharCollection({ collected, onFilterTierChange }: CharCollectionProps) {
  const [tier, setTier] = useState<number | null>(null);
  const entries = Object.entries(collected);
  const tiers = Array.from(
    new Set(
      entries
        .map(([, snapshot]) => snapshot.hsk)
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value)),
    ),
  ).sort((left, right) => left - right);
  const visible = tier === null ? entries : entries.filter(([, snapshot]) => snapshot.hsk === tier);

  function pickTier(next: number | null): void {
    setTier(next);
    onFilterTierChange(next);
  }

  if (entries.length === 0) {
    return <p className="py-10 text-center text-ink-faint">还没有认会的字 —— 去闯关</p>;
  }

  return (
    <div>
      <div role="group" aria-label="HSK 分级" className="mb-3 flex gap-2">
        <button
          type="button"
          onClick={() => pickTier(null)}
          aria-pressed={tier === null}
          className={`rounded border px-2 py-1 text-sm ${
            tier === null
              ? 'bg-seal text-white border-seal'
              : 'bg-paper-deep border-ink/30 hover:bg-paper'
          }`}
        >
          全部
        </button>
        {tiers.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => pickTier(value)}
            aria-pressed={tier === value}
            className={`rounded border px-2 py-1 text-sm ${
              tier === value
                ? 'bg-seal text-white border-seal'
                : 'bg-paper-deep border-ink/30 hover:bg-paper'
            }`}
          >
            HSK {value}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {visible.map(([char, snapshot]) => (
          <CharCard key={char} char={char} snapshot={snapshot} />
        ))}
      </div>
    </div>
  );
}
