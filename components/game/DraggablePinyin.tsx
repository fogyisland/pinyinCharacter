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
      <div className="invisible rounded border border-gray-300 bg-gray-100 px-3 py-2 text-sm">
        {text}
      </div>
    );
  }
  return (
    <div
      draggable={!disabled}
      onDragStart={(e) => onDragStart(e, id)}
      className={`cursor-grab rounded border border-blue-300 bg-white px-3 py-2 text-sm transition active:cursor-grabbing ${
        disabled ? 'opacity-50' : 'hover:bg-blue-50'
      }`}
    >
      {text}
    </div>
  );
}
