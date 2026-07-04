'use client';
import type { HskLevel } from '@/lib/difficulty';

type Props = {
  hskLevel: HskLevel;
  available: boolean;
};

export function FallbackBanner({ hskLevel, available }: Props) {
  if (available) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded border border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-900"
    >
      HSK {hskLevel} 字库尚在补充中—当前以 HSK {Math.max(1, hskLevel - 1)} 字池代替
    </div>
  );
}