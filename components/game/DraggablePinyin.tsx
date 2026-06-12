'use client';

import { DragEvent } from 'react';

interface Props {
  id: string;
  text: string;
  disabled?: boolean;
  onDragStart: (e: DragEvent<HTMLDivElement>, id: string) => void;
  matched?: boolean;
}

export function DraggablePinyin({ id, text, disabled, onDragStart, matched }: Props) {
  if (matched) {
    return (
      <div className="invisible rounded border border-ink/20 bg-paper-deep px-3 py-2 text-sm">
        {text}
      </div>
    );
  }
  return (
    <div
      draggable={!disabled}
      onDragStart={(e) => onDragStart(e, id)}
      className={`cursor-grab rounded border border-seal/30 bg-paper px-3 py-2 text-sm transition active:cursor-grabbing ${
        disabled ? 'opacity-50' : 'hover:bg-seal/10'
      }`}
    >
      {text}
    </div>
  );
}
