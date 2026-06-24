'use client';

import type { FontFamily, Tool } from '@/lib/worksheet-types';
import { FONT_FAMILIES, fontFamilyLabel } from '@/lib/worksheet-types';

interface Props {
  /** Currently selected tool. Brush tool hides hard-pen fonts and vice versa,
   *  so the user can't pick a 毛笔 font while in 钢笔 mode (or vice versa). */
  tool: Tool;
  value: FontFamily;
  onChange: (v: FontFamily) => void;
}

const GROUPS = [
  { key: 'system', label: '系统字体' },
  { key: 'hard-pen', label: '硬笔字体' },
  { key: 'brush', label: '毛笔字体' },
] as const;

/** Groups visible for a given tool. System fonts are always shown. */
function visibleGroupKeys(tool: Tool): ReadonlyArray<(typeof GROUPS)[number]['key']> {
  if (tool === 'brush') return ['system', 'brush'];
  return ['system', 'hard-pen'];
}

export function FontFamilyPicker({ tool, value, onChange }: Props) {
  const visible = new Set(visibleGroupKeys(tool));
  const visibleOptions = FONT_FAMILIES.filter((f) => visible.has(f.group));
  // If the current value is in a hidden group (e.g. user had a brush font and
  // switched to pen), keep it rendered as an option so the select can display
  // the chosen font instead of silently falling back to the first option.
  const valueIsHidden = !visibleOptions.some((f) => f.value === value);
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as FontFamily)}
      className="rounded border border-ink/20 bg-paper px-3 py-1.5 text-sm"
    >
      {valueIsHidden && (
        <option value={value} style={{ fontFamily: FONT_FAMILIES.find((f) => f.value === value)?.cssVar }}>
          {fontFamilyLabel(value)}
        </option>
      )}
      {GROUPS.filter((g) => visible.has(g.key)).map((g) => (
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
