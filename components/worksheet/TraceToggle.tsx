'use client';

interface Props {
  value: boolean;
  onChange: (v: boolean) => void;
}

export function TraceToggle({ value, onChange }: Props) {
  return (
    <label className="flex cursor-pointer items-center gap-2">
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>描红 <span className="text-xs text-ink-faint">(仅毛笔)</span></span>
    </label>
  );
}