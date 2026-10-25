import type { DragEvent } from 'react';

interface Props {
  radical: string;
  matched: boolean;
  onDragStart: (radical: string) => void;
  /**
   * Index of this token inside the round's token bank. When it is present the
   * token is draggable and its drag payload is this INDEX — the client
   * resolves the token's value from the same array, so two tokens showing the
   * same radical stay distinguishable. When it is absent the token renders as
   * a static chip: it shows the value but cannot be dragged.
   */
  tokenIndex?: number;
}

export function RadicalToken({ radical, matched, onDragStart, tokenIndex }: Props) {
  const handleDragStart = (e: DragEvent<HTMLDivElement>) => {
    if (tokenIndex === undefined) return;
    e.dataTransfer.setData('text/plain', String(tokenIndex));
    e.dataTransfer.effectAllowed = 'move';
    onDragStart(radical);
  };

  const isDraggable = tokenIndex !== undefined && !matched;

  return (
    <div
      draggable={isDraggable}
      onDragStart={isDraggable ? handleDragStart : undefined}
      className={`flex h-12 min-w-12 ${isDraggable ? 'cursor-grab active:cursor-grabbing' : ''} select-none items-center justify-center rounded border-2 border-seal bg-paper px-3 text-2xl font-kai text-ink shadow-sm ${
        matched ? 'pointer-events-none opacity-30' : 'hover:bg-seal/10'
      }`}
      aria-label={`部首 ${radical}`}
      role="button"
    >
      {radical}
    </div>
  );
}
