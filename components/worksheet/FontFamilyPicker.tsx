'use client';

import type { FontFamily } from '@/lib/worksheet-types';
import { FONT_FAMILIES } from '@/lib/worksheet-types';

interface Props {
  value: FontFamily;
  onChange: (v: FontFamily) => void;
}

export function FontFamilyPicker({ value, onChange }: Props) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      {FONT_FAMILIES.map((f) => (
        <label key={f.value} className="flex cursor-pointer items-center gap-2">
          <input
            type="radio"
            name="fontFamily"
            value={f.value}
            checked={value === f.value}
            onChange={() => onChange(f.value)}
          />
          <span style={{ fontFamily: f.cssVar }}>{f.label}</span>
        </label>
      ))}
    </div>
  );
}
