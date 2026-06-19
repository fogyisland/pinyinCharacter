'use client';

import type { FontFamily } from '@/lib/worksheet-types';
import { FONT_FAMILIES, fontFamilyLabel } from '@/lib/worksheet-types';

interface Props {
  value: FontFamily;
  onChange: (v: FontFamily) => void;
}

const GROUPS = [
  { key: 'system', label: '系统字体' },
  { key: 'hard-pen', label: '硬笔字体' },
] as const;

export function FontFamilyPicker({ value, onChange }: Props) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as FontFamily)}
      className="rounded border border-ink/20 bg-paper px-3 py-1.5 text-sm"
    >
      {GROUPS.map((g) => (
        <optgroup key={g.key} label={g.label}>
          {FONT_FAMILIES.filter((f) => f.group === g.key).map((f) => (
            <option key={f.value} value={f.value} style={{ fontFamily: f.cssVar }}>
              {fontFamilyLabel(f.value)}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
