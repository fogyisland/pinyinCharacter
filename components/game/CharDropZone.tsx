'use client';

import { DragEvent } from 'react';

interface Props {
  charId: string;
  char: string;
  matchedPinyin: string | null;
  onDrop: (charId: string, pinyinId: string) => void;
}

export function CharDropZone({ charId, char, matchedPinyin, onDrop }: Props) {
  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const pinyinId = e.dataTransfer.getData('text/plain');
    if (pinyinId) onDrop(charId, pinyinId);
  };

  return (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
      className="flex items-center gap-3 rounded border border-gray-300 bg-white p-3"
    >
      <span className="text-3xl font-bold">{char}</span>
      <span className="text-sm text-gray-500">→</span>
      <span className="flex-1 rounded border border-dashed border-gray-300 px-3 py-1 text-sm text-gray-400">
        {matchedPinyin ?? '拖动拼音到这里'}
      </span>
    </div>
  );
}
