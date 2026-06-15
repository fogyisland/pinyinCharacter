'use client';

import type { PaperSize } from '@/lib/worksheet-types';
import { PAPER_SIZES } from '@/lib/worksheet-types';

interface Props {
  value: PaperSize;
  onChange: (v: PaperSize) => void;
}

export function PaperSizePicker({ value, onChange }: Props) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      {PAPER_SIZES.map((p) => (
        <label key={p.value} className="flex cursor-pointer items-center gap-2">
          <input
            type="radio"
            name="paperSize"
            value={p.value}
            checked={value === p.value}
            onChange={() => onChange(p.value)}
          />
          <span>{p.label} <span className="text-xs text-ink-faint">≈{p.cellsPerPage}字/页</span></span>
        </label>
      ))}
    </div>
  );
}
