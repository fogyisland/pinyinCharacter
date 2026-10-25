'use client';

/**
 * The level map of a tier.
 *
 * One tile per level. A tile is startable when its level is at or below the
 * tier's pointer; the pointer itself is the 当前 tile, a passed level wears
 * the 朱红 「通」 seal and a locked level is not clickable at all.
 */
export interface QuestBoardProps {
  tier: number;
  levelCount: number;
  /** The tier's current level pointer (1-based). */
  currentLevel: number;
  /** The levels that were 通关. */
  passedLevels: number[];
  onOpenLevel: (level: number) => void;
}

type TileState = 'current' | 'passed' | 'available' | 'locked';

const TILE_CLASS: Record<TileState, string> = {
  current: 'bg-ink border-ink text-paper',
  passed: 'bg-paper-deep border-seal text-seal',
  available: 'bg-paper border-ink/30 text-ink hover:bg-paper-deep',
  locked: 'bg-paper-deep/60 border-ink/10 text-ink-faint',
};

export function QuestBoard({
  tier,
  levelCount,
  currentLevel,
  passedLevels,
  onOpenLevel,
}: QuestBoardProps) {
  const total = Number.isFinite(levelCount) ? Math.max(0, Math.floor(levelCount)) : 0;
  // A pointer beyond the tier's level count is stale (the content shrank, or
  // the storage was hand-edited) - it is clamped to the last level, and the
  // tiles that do not exist are never rendered.
  const pointer = Math.min(
    Math.max(Number.isFinite(currentLevel) ? Math.floor(currentLevel) : 1, 1),
    Math.max(total, 1),
  );
  const passed = new Set(passedLevels);
  const tiles = Array.from({ length: total }, (_, index) => index + 1);

  return (
    <div>
      <p className="mb-2 text-sm text-ink-soft">
        HSK {tier} · 共 {total} 关
      </p>
      <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
        {tiles.map((level) => {
          const isCurrent = level === pointer;
          const isPassed = passed.has(level);
          const state: TileState = isCurrent
            ? 'current'
            : isPassed
              ? 'passed'
              : level <= pointer
                ? 'available'
                : 'locked';
          const label = (
            <>
              <span>{level}</span>
              {isPassed ? <span className="ml-1 text-[10px]">通</span> : null}
            </>
          );
          if (state === 'locked') {
            return (
              <span
                key={level}
                data-level={level}
                data-state={state}
                aria-disabled="true"
                className={`rounded border px-2 py-3 text-center text-sm ${TILE_CLASS[state]}`}
              >
                {label}
              </span>
            );
          }
          return (
            <button
              key={level}
              type="button"
              data-level={level}
              data-state={state}
              onClick={() => onOpenLevel(level)}
              className={`rounded border px-2 py-3 text-center text-sm transition-colors ${TILE_CLASS[state]}`}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
