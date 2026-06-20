'use client';

import type { Tool } from '@/lib/worksheet-types';

interface Props {
  value: Tool;
  onChange: (v: Tool) => void;
}

export function ToolPicker({ value, onChange }: Props) {
  return (
    <div className="flex gap-4">
      <label className="flex cursor-pointer items-center gap-2">
        <input
          type="radio"
          name="tool"
          value="brush"
          checked={value === 'brush'}
          onChange={() => onChange('brush')}
        />
        <span>毛笔</span>
      </label>
      <label className="flex cursor-pointer items-center gap-2">
        <input
          type="radio"
          name="tool"
          value="pen"
          checked={value === 'pen'}
          onChange={() => onChange('pen')}
        />
        <span>钢笔</span>
      </label>
    </div>
  );
}