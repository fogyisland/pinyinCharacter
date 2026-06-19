'use client';
import type { BrushPaperSize } from '@/lib/worksheet-types';

const MODES: { value: BrushPaperSize; label: string; hint: string }[] = [
  { value: 'brush-12', label: '12 字', hint: '每页大字练习' },
  { value: 'brush-24', label: '24 字', hint: '每页中字练习' },
  { value: 'brush-28', label: '28 字', hint: '每页小字练习' },
];

interface Props {
  value: BrushPaperSize;
  onChange: (v: BrushPaperSize) => void;
}

export function BrushModePicker({ value, onChange }: Props) {
  return (
    <div className="flex flex-wrap gap-2">
      {MODES.map((m) => {
        const selected = value === m.value;
        return (
          <button
            key={m.value}
            type="button"
            onClick={() => onChange(m.value)}
            aria-pressed={selected}
            className={`rounded-md border px-3 py-1.5 text-sm ${
              selected
                ? 'border-seal bg-seal/10 text-seal font-medium'
                : 'border-ink/20 hover:bg-paper-deep'
            }`}
          >
            {m.label}
            <span className="ml-1 text-xs text-ink-faint">{m.hint}</span>
          </button>
        );
      })}
    </div>
  );
}
