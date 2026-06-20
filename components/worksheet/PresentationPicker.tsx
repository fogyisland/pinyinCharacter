'use client';

import type { Presentation } from '@/lib/worksheet-types';

interface Props {
  value: Presentation;
  onChange: (v: Presentation) => void;
}

export function PresentationPicker({ value, onChange }: Props) {
  return (
    <div className="flex gap-4">
      <label className="flex cursor-pointer items-center gap-2">
        <input
          type="radio"
          name="presentation"
          value="square"
          checked={value === 'square'}
          onChange={() => onChange('square')}
        />
        <span>田字格</span>
      </label>
      <label className="flex cursor-pointer items-center gap-2">
        <input
          type="radio"
          name="presentation"
          value="cross"
          checked={value === 'cross'}
          onChange={() => onChange('cross')}
        />
        <span>米字格</span>
      </label>
    </div>
  );
}