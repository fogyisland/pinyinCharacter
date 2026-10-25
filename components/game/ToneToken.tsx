import type { DragEvent } from 'react';
import type { Tone } from '@/lib/pinyin-tone';

interface Props {
  tone: Tone;
  matched: boolean;
  onDragStart: (tone: Tone) => void;
  /**
   * Index of this token inside the round's token bank. When it is present the
   * token is draggable and its drag payload is this INDEX — the client
   * resolves the token's value from the same array, so two tokens showing the
   * same tone stay distinguishable. When it is absent the token renders as a
   * static chip: it shows the value but cannot be dragged.
   */
  tokenIndex?: number;
}

export function ToneToken({ tone, matched, onDragStart, tokenIndex }: Props) {
  const handleDragStart = (e: DragEvent<HTMLDivElement>) => {
    if (tokenIndex === undefined) return;
    e.dataTransfer.setData('text/plain', String(tokenIndex));
    e.dataTransfer.effectAllowed = 'move';
    onDragStart(tone);
  };

  const isDraggable = tokenIndex !== undefined && !matched;

  return (
    <div
      draggable={isDraggable}
      onDragStart={isDraggable ? handleDragStart : undefined}
      className={`flex h-12 w-12 cursor-grab select-none items-center justify-center rounded-full border-2 border-seal bg-paper text-2xl font-kai text-seal shadow-sm active:cursor-grabbing ${
        matched ? 'pointer-events-none opacity-30' : 'hover:bg-seal/10'
      }`}
      aria-label={`声调 ${tone}`}
      role="button"
    >
      {tone}
    </div>
  );
}
