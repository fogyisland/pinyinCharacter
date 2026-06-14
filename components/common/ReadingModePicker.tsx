'use client';

import { SUTRA_READING_LABELS, type SutraReading } from '@/lib/sutra-reading';

const OPTIONS: { value: SutraReading; label: string }[] = (
  Object.entries(SUTRA_READING_LABELS) as [SutraReading, string][]
).map(([value, label]) => ({ value, label }));

export function ReadingModePicker({
  value,
  onChange,
  className = '',
}: {
  value: SutraReading;
  onChange: (next: SutraReading) => void;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="阅读方向"
      className={`inline-flex items-center rounded-sm border border-ink/20 bg-paper-soft p-0.5 ${className}`}
    >
      {OPTIONS.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.value)}
            className={`px-3 py-1 text-xs sm:text-sm font-kai transition-colors rounded-sm ${
              active
                ? 'bg-seal text-paper-soft shadow-sm'
                : 'text-ink-soft hover:text-ink hover:bg-paper-deep'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}