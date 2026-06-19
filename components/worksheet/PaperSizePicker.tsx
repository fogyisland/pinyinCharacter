'use client';
import type { CellStyle, PaperSize } from '@/lib/worksheet-types';
import { PAPER_SIZES, isBrushSize } from '@/lib/worksheet-types';
import { BrushModePicker } from './BrushModePicker';

interface Props {
  value: PaperSize;
  cellStyle: CellStyle;
  onChange: (v: PaperSize) => void;
}

export function PaperSizePicker({ value, cellStyle, onChange }: Props) {
  if (cellStyle === 'brush') {
    if (!isBrushSize(value)) {
      // Defensive: value should always be a brush size when cellStyle='brush',
      // because WorksheetGenerator's handleCellStyleChange auto-flips paper size
      // on cell-style change. If we land here, the parent forgot — self-heal.
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
