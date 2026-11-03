'use client';
import type { HskLevel } from '@/lib/difficulty';

type Props = {
  hskLevel: HskLevel;
  available: boolean;
  /**
   * 2026-11-03: the tier holds NO chars at all — the HSK grading was never
   * imported on this server (`scripts/import-hsk.ts` is a deployment step,
   * not a migration).
   *
   * This is a different situation from a thin tier, and the old text
   * described it wrongly: it said "the HSK N pool is still being filled in,
   * using the HSK N-1 pool instead", which is both untrue (the fallback is
   * the whole pool, not the tier below) and unhelpful (nothing is being
   * filled in — an administrator has to run one command).
   */
  tierMissing?: boolean;
};

export function FallbackBanner({ hskLevel, available, tierMissing = false }: Props) {
  if (available) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded border border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-900"
    >
      {tierMissing
        ? `HSK ${hskLevel} 的分级数据尚未导入 —— 当前以本难度的常用汉字代替`
        : `HSK ${hskLevel} 字库尚在补充中 — 当前以本难度的常用汉字代替`}
    </div>
  );
}
