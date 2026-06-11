'use client';

import { CellStyle } from '@/lib/worksheet';

interface Props {
  value: CellStyle;
  onChange: (v: CellStyle) => void;
}

export function StylePicker({ value, onChange }: Props) {
  return (
    <div className="flex gap-4">
      <label className="flex cursor-pointer items-center gap-2">
        <input
          type="radio"
          name="cellStyle"
          value="brush"
          checked={value === 'brush'}
          onChange={() => onChange('brush')}
        />
        <span>毛笔格</span>
      </label>
      <label className="flex cursor-pointer items-center gap-2">
        <input
          type="radio"
          name="cellStyle"
          value="square"
          checked={value === 'square'}
          onChange={() => onChange('square')}
        />
        <span>田字格</span>
      </label>
    </div>
  );
}
