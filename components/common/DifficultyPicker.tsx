'use client';

import type { Difficulty } from '@/lib/difficulty';

const OPTIONS: { value: Difficulty; label: string }[] = [
  { value: 'easy', label: '简单' },
  { value: 'medium', label: '复杂' },
  { value: 'hard', label: '超难' },
];

export function DifficultyPicker({
  value,
  onChange,
  className = '',
}: {
  value: Difficulty;
  onChange: (next: Difficulty) => void;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="难度"
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
