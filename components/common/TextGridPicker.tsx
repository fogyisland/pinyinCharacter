'use client';

import { TEXT_GRID_LABEL, type TextGridMode } from '@/lib/text-grid';

const OPTIONS: { value: TextGridMode; label: string }[] = [
  { value: 'default', label: TEXT_GRID_LABEL.default },
  { value: 'tian', label: TEXT_GRID_LABEL.tian },
  { value: 'mi', label: TEXT_GRID_LABEL.mi },
];

interface Props {
  value: TextGridMode;
  onChange: (v: TextGridMode) => void;
}

export function TextGridPicker({ value, onChange }: Props) {
  return (
    <div className="inline-flex rounded border border-ink/20 overflow-hidden text-sm bg-paper">
      {OPTIONS.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            aria-pressed={active}
            className={
              'px-3 py-1 transition-colors border-r border-ink/10 last:border-r-0 ' +
              (active ? 'bg-seal text-paper' : 'text-ink-soft hover:bg-paper-deep')
            }
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}