'use client';
import type { Tool, PaperSize } from '@/lib/worksheet-types';
import { PAPER_SIZES, isBrushSize } from '@/lib/worksheet-types';
import { BrushModePicker } from './BrushModePicker';

interface Props {
  value: PaperSize;
  tool: Tool;
  onChange: (v: PaperSize) => void;
}

export function PaperSizePicker({ value, tool, onChange }: Props) {
  if (tool === 'brush') {
    if (!isBrushSize(value)) {
      // Defensive: same self-heal as before, just keyed on tool
      onChange('brush-12');
      return <BrushModePicker value="brush-12" onChange={onChange} />;
    }
    return <BrushModePicker value={value} onChange={onChange} />;
  }
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      {PAPER_SIZES.filter((p) => !isBrushSize(p.value)).map((p) => (
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
